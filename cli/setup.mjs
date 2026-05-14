// cli/setup.mjs
import readline from 'node:readline';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execSync } from 'node:child_process';
import { getConfigDir, getConfigPath, loadConfig, saveConfig } from '../src/config-loader.mjs';
import { patchClaude, patchCodex, patchCursor, patchGemini } from '../setup/patch-config.mjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const PLATFORM = os.platform();

function ask(rl, question, defaultVal) {
  return new Promise((resolve) => {
    const suffix = defaultVal ? ` (${defaultVal})` : '';
    rl.question(`  ? ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

function askYN(rl, question, defaultYes = true) {
  return new Promise((resolve) => {
    const hint = defaultYes ? '(Y/n)' : '(y/N)';
    rl.question(`  ? ${question} ${hint}: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (!a) { resolve(defaultYes); return; }
      resolve(a === 'y' || a === 'yes');
    });
  });
}

function log(msg, color = '') {
  const colors = { green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', dim: '\x1b[2m', reset: '\x1b[0m', bold: '\x1b[1m' };
  const c = colors[color] || '';
  console.log(`${c}${msg}${colors.reset}`);
}

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
  return `ai-agent-notifier-${suffix}`;
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

export async function run() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  log('\n  ai-agent-notifier \u2014 cross-platform AI agent notifications\n', 'bold');

  // 1. Platform
  const platLabel = PLATFORM === 'win32' ? 'Windows' : PLATFORM === 'darwin' ? 'macOS' : 'Linux';
  log(`  Detecting platform... ${platLabel}`, 'cyan');

  // 2. Detect tools
  log('  Detecting tools...', 'cyan');
  const tools = detectTools();
  const allTools = ['Claude Code', 'Codex CLI', 'Cursor IDE', 'Gemini CLI'];
  const foundNames = tools.map(t => t.label);
  for (const t of allTools) {
    if (foundNames.includes(t)) log(`    \u2713 ${t}`, 'green');
    else log(`    \u2717 ${t} (not installed)`, 'dim');
  }

  if (tools.length === 0) {
    log('\n  No supported AI tools found. Install Claude Code, Codex, Gemini CLI, or Cursor first.', 'red');
    rl.close();
    return;
  }

  // 3. Toast backend
  log('\n  Installing toast backend...', 'cyan');
  if (PLATFORM === 'win32') {
    if (installBurntToast()) log('    \u2713 BurntToast module ready', 'green');
    else log('    \u2717 BurntToast install failed \u2014 toasts may not work', 'yellow');
  } else if (PLATFORM === 'darwin') {
    log('    \u2713 osascript (built-in)', 'green');
  } else {
    try { execSync('which notify-send', { stdio: 'pipe' }); log('    \u2713 notify-send available', 'green'); }
    catch { log('    \u2717 notify-send not found \u2014 install libnotify for toasts', 'yellow'); }
  }

  // 4. Icon
  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true });
  const iconPath = path.join(configDir, 'icon.png');
  if (!fs.existsSync(iconPath)) {
    const ok = await downloadIcon(iconPath);
    if (ok) log('    \u2713 Notification icon downloaded', 'green');
    else log('    \u2717 Icon download failed (toasts will use default icon)', 'yellow');
  }

  // 5. ntfy config
  const enableNtfy = await askYN(rl, 'Enable phone notifications via ntfy?');
  const config = loadConfig();

  if (enableNtfy) {
    config.ntfy.enabled = true;
    config.ntfy.server = await ask(rl, 'ntfy server', config.ntfy.server || 'https://ntfy.sh');
    const existingTopic = migrateExistingTopic() || config.ntfy.topic;
    const topic = await ask(rl, 'ntfy topic', existingTopic || generateTopic());
    config.ntfy.topic = topic;
  } else {
    config.ntfy.enabled = false;
  }

  saveConfig(getConfigPath(), config);
  log('    \u2713 Config saved', 'green');

  // 6. Patch tool configs
  log('\n  Patching tool configs...', 'cyan');
  const notifyPath = resolveNotifyPath();
  const backupDir = path.join(configDir, 'backups');

  const patchers = {
    claude: patchClaude,
    codex: patchCodex,
    cursor: patchCursor,
    gemini: patchGemini,
  };

  for (const tool of tools) {
    try {
      patchers[tool.name](tool.dir, notifyPath, backupDir);
      log(`    \u2713 ${tool.label}`, 'green');
    } catch (err) {
      log(`    \u2717 ${tool.label}: ${err.message}`, 'red');
    }
  }
  log(`    Backed up originals to ${backupDir}`, 'dim');

  // 7. ntfy info
  if (config.ntfy.enabled && config.ntfy.topic) {
    const url = `${config.ntfy.server}/${config.ntfy.topic}`;
    log('\n  =======================================', 'cyan');
    log('    Phone notifications \u2014 subscribe in the ntfy app', 'cyan');
    log('  =======================================', 'cyan');
    log(`    Topic: ${config.ntfy.topic}`);
    log(`    URL:   ${url}`);
    log('');
    log('    Install the ntfy app (Android/iOS), then subscribe to the URL above.');
  }

  // 8. Summary
  log('\n  \u2713 Setup complete. Restart your AI tools to activate.\n', 'green');

  rl.close();
}
