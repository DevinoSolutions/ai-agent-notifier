// cli/setup.mjs
import readline from 'node:readline';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execSync } from 'node:child_process';
import { getConfigDir, getConfigPath, loadConfigResult, saveConfig } from '../src/config-loader.mjs';
import { patchClaude, patchCodex, patchCursor, patchGemini } from '../setup/patch-config.mjs';
import { ask, askYN, log } from './ui.mjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const PLATFORM = os.platform();

function detectTools() {
  const tools = [];
  const claudeDir = path.join(HOME, '.claude');
  if (fs.existsSync(path.join(claudeDir, 'settings.json'))) {
    tools.push({ name: 'claude', label: 'Claude Code', dir: claudeDir });
  }
  const codexDir = path.join(HOME, '.codex');
  if (fs.existsSync(codexDir)) {
    tools.push({ name: 'codex', label: 'Codex CLI', dir: codexDir });
  }
  const cursorDir = path.join(HOME, '.cursor');
  if (fs.existsSync(cursorDir)) {
    tools.push({ name: 'cursor', label: 'Cursor IDE', dir: cursorDir });
  }
  const geminiDir = path.join(HOME, '.gemini');
  if (fs.existsSync(geminiDir)) {
    tools.push({ name: 'gemini', label: 'Gemini CLI', dir: geminiDir });
  }
  return tools;
}

function generateTopic() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 16; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `anotifier-${suffix}`;
}

function resolveNotifyPath() {
  const packageNotify = path.resolve(__dirname, '..', 'src', 'notify.mjs');
  if (fs.existsSync(packageNotify)) return packageNotify;
  return path.join(getConfigDir(), 'src', 'notify.mjs');
}

function downloadIcon(destPath) {
  return new Promise((resolve) => {
    const url = 'https://claude.ai/images/claude_app_icon.png';
    const file = fs.createWriteStream(destPath);
    https.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) { file.close(); resolve(false); return; }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(true); });
    }).on('error', () => { file.close(); resolve(false); });
  });
}

function installBurntToast() {
  try {
    execSync('pwsh -NoProfile -Command "if (-not (Get-Module -ListAvailable -Name BurntToast)) { Install-Module BurntToast -Scope CurrentUser -Force -AcceptLicense }"', { stdio: 'pipe', timeout: 30000 });
    return true;
  } catch { return false; }
}

function migrateExistingTopic() {
  const oldConfig = path.join(HOME, '.claude', 'ntfy-config.json');
  try {
    const data = JSON.parse(fs.readFileSync(oldConfig, 'utf8'));
    if (data.topic) return data.topic;
  } catch { /* no old config */ }
  return null;
}

// Collect stdin into memory before any synchronous blocking operations.
// On Windows, execSync (e.g. BurntToast install) blocks the event loop for tens of seconds.
// During that time, the OS pipe buffer fills and stdin EOF arrives. When the event loop
// resumes, readline has already processed all buffered input and closed — causing
// "readline was closed" on subsequent rl.question() calls.
// Fix: collect all stdin upfront, then create a readline shim that serves answers on demand.
function collectStdin() {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      const chunks = [];
      process.stdin.on('data', (c) => chunks.push(c));
      process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      process.stdin.on('error', () => resolve(''));
      process.stdin.resume();
    } else {
      resolve(null); // TTY: readline reads live from stdin directly
    }
  });
}

// A readline-compatible shim that pops answers from a pre-collected lines array.
// question(prompt, callback) immediately calls callback with the next raw line
// (callers ask()/askYN() trim it), so it works correctly even after all stdin
// data has been received.
function makeLineShim(lines) {
  let idx = 0;
  return {
    get closed() { return false; },
    question(prompt, callback) {
      process.stdout.write(prompt);
      const answer = idx < lines.length ? lines[idx++] : '';
      // Use setImmediate to be async like real readline (avoids stack overflows and
      // ensures the calling async function can properly await between questions).
      setImmediate(() => callback(answer));
    },
    close() { /* no-op: no underlying stream to close */ },
  };
}

export async function run() {
  // Ctrl+C during the wizard aborts before anything is written. All answers are
  // collected first and the config/patches are written only at the end, so an
  // abort here genuinely leaves nothing behind.
  process.on('SIGINT', () => {
    log('\n  aborted — nothing saved', 'red');
    process.exit(130);
  });

  // Collect all stdin before any synchronous blocking work (Windows execSync safety).
  const stdinData = await collectStdin();

  let rl;
  if (stdinData !== null) {
    // Non-TTY (piped): serve answers from the pre-collected buffer, one per question call.
    const lines = stdinData.split(/\r?\n/);
    rl = makeLineShim(lines);
  } else {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }

  log('\n  anotifier — cross-platform AI agent notifications\n', 'bold');

  // 1. Platform
  const platLabel = PLATFORM === 'win32' ? 'Windows' : PLATFORM === 'darwin' ? 'macOS' : 'Linux';
  log(`  Detecting platform... ${platLabel}`, 'cyan');

  // 2. Detect tools
  log('  Detecting tools...', 'cyan');
  const tools = detectTools();
  const allTools = ['Claude Code', 'Codex CLI', 'Cursor IDE', 'Gemini CLI'];
  const foundNames = tools.map(t => t.label);
  for (const t of allTools) {
    if (foundNames.includes(t)) log(`    ✓ ${t}`, 'green');
    else log(`    ✗ ${t} (not installed)`, 'dim');
  }

  if (tools.length === 0) {
    // Nothing was set up — fail loud so scripts and users don't read this as success.
    log('\n  No supported AI tools found. Install Claude Code, Codex, Gemini CLI, or Cursor first.', 'red');
    rl.close();
    process.exitCode = 1;
    return;
  }

  // 3. Toast backend
  log('\n  Installing toast backend...', 'cyan');
  if (PLATFORM === 'win32') {
    if (installBurntToast()) log('    ✓ BurntToast module ready', 'green');
    else log('    ✗ BurntToast install failed — toasts may not work', 'yellow');
  } else if (PLATFORM === 'darwin') {
    log('    ✓ osascript (built-in)', 'green');
  } else {
    try { execSync('which notify-send', { stdio: 'pipe' }); log('    ✓ notify-send available', 'green'); }
    catch { log('    ✗ notify-send not found — install libnotify for toasts', 'yellow'); }
  }

  // 4. Icon
  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true });
  const iconPath = path.join(configDir, 'icon.png');
  if (!fs.existsSync(iconPath)) {
    const ok = await downloadIcon(iconPath);
    if (ok) log('    ✓ Notification icon downloaded', 'green');
    else log('    ✗ Icon download failed (toasts will use default icon)', 'yellow');
  }

  // 5. Load config (fail loud on a corrupt file, but offer to rebuild it)
  const { config, problem } = loadConfigResult(getConfigPath());
  if (problem) {
    log(`  ${problem.message}`, 'red');
    const rebuild = await askYN(rl, `config.json is invalid (${problem.type}). Rebuild it from scratch?`, false);
    if (!rebuild) {
      log('  aborted — existing config.json left untouched', 'red');
      rl.close();
      process.exitCode = 1;
      return;
    }
    // Proceed: `config` holds a clean, usable config to overwrite the bad file with.
  }

  // 6. ntfy config
  const enableNtfy = await askYN(rl, 'Enable phone notifications via ntfy?');
  if (enableNtfy) {
    config.ntfy.enabled = true;
    config.ntfy.server = await ask(rl, 'ntfy server', config.ntfy.server || 'https://ntfy.sh');
    const existingTopic = migrateExistingTopic() || config.ntfy.topic;
    const topic = await ask(rl, 'ntfy topic', existingTopic || generateTopic());
    config.ntfy.topic = topic;
  } else {
    config.ntfy.enabled = false;
  }

  saveConfig(config, getConfigPath());
  log('    ✓ Config saved', 'green');

  // 7. Patch tool configs — collect failures so we never claim success on error.
  log('\n  Patching tool configs...', 'cyan');
  const notifyPath = resolveNotifyPath();
  const backupDir = path.join(configDir, 'backups');

  const patchers = {
    claude: patchClaude,
    codex: patchCodex,
    cursor: patchCursor,
    gemini: patchGemini,
  };

  const failures = [];
  for (const tool of tools) {
    try {
      patchers[tool.name](tool.dir, notifyPath, backupDir);
      log(`    ✓ ${tool.label}`, 'green');
    } catch (err) {
      log(`    ✗ ${tool.label}: ${err.message}`, 'red');
      failures.push({ tool: tool.label, reason: err.message });
    }
  }

  if (failures.length) {
    log('\n  Setup failed — some tools were not patched:', 'red');
    for (const f of failures) log(`    ✗ ${f.tool}: ${f.reason}`, 'red');
    log('    Fix the errors above and re-run setup.', 'yellow');
    rl.close();
    process.exitCode = 1;
    return;
  }

  log(`    Backed up originals to ${backupDir}`, 'dim');

  // 8. ntfy info
  if (config.ntfy.enabled && config.ntfy.topic) {
    const url = `${config.ntfy.server}/${config.ntfy.topic}`;
    log('\n  =======================================', 'cyan');
    log('    Phone notifications — subscribe in the ntfy app', 'cyan');
    log('  =======================================', 'cyan');
    log(`    Topic: ${config.ntfy.topic}`);
    log(`    URL:   ${url}`);
    log('');
    log('    Install the ntfy app (Android/iOS), then subscribe to the URL above.');
  }

  // 9. Summary — only reached when every detected tool patched cleanly.
  log('\n  ✓ Setup complete. Restart your AI tools to activate.\n', 'green');

  rl.close();
}
