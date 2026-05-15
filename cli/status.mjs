// cli/status.mjs
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadConfig, getConfigDir } from '../src/config-loader.mjs';
import { checkForUpdate } from './index.mjs';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

function log(msg, color = '') {
  const colors = { green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', dim: '\x1b[2m', reset: '\x1b[0m', bold: '\x1b[1m' };
  console.log(`${colors[color] || ''}${msg}${colors.reset}`);
}

function checkTool(name, label, configFile) {
  const filePath = path.join(os.homedir(), name, configFile);
  if (!fs.existsSync(filePath)) return { label, status: 'not installed', events: [] };
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const hooks = data.hooks || {};
    const managed = Object.keys(hooks).filter(event =>
      Array.isArray(hooks[event]) && hooks[event].some(h =>
        h._managed_by === 'ai-agent-notifier' || h.hooks?.some(hh => hh.command?.includes('notify.mjs'))
      )
    );
    return { label, status: managed.length > 0 ? 'wired' : 'not wired', events: managed };
  } catch { return { label, status: 'config error', events: [] }; }
}

export async function run() {
  const config = loadConfig();
  const platform = os.platform();
  const platLabel = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux';
  const toastLabel = platform === 'win32' ? 'BurntToast' : platform === 'darwin' ? 'osascript' : 'notify-send';

  log(`\n  ai-agent-notifier v${pkg.version}\n`, 'bold');
  log(`  Platform:    ${platLabel}`);
  log(`  Toast:       ${toastLabel}${config.toast?.clickToFocus ? ' (click-to-focus enabled)' : ''}`);

  if (config.ntfy?.enabled && config.ntfy?.topic) {
    log(`  ntfy:        ${config.ntfy.server}/${config.ntfy.topic}`);
  } else {
    log('  ntfy:        disabled', 'dim');
  }

  log('\n  Tools:', 'cyan');
  const tools = [
    checkTool('.claude', 'Claude Code', 'settings.json'),
    checkTool('.codex', 'Codex CLI', 'hooks.json'),
    checkTool('.cursor', 'Cursor IDE', 'hooks.json'),
    checkTool('.gemini', 'Gemini CLI', 'hooks.json'),
  ];

  for (const t of tools) {
    const icon = t.status === 'wired' ? '\u2713' : '\u2717';
    const color = t.status === 'wired' ? 'green' : 'dim';
    const events = t.events.length > 0 ? ` (${t.events.join(', ')})` : ` (${t.status})`;
    log(`    ${icon} ${t.label}${events}`, color);
  }

  log('\n  Events:', 'cyan');
  for (const [event, conf] of Object.entries(config.events || {})) {
    const toast = conf.toastEnabled !== false ? '\u2713' : '\u2717';
    const ntfy = conf.ntfyEnabled !== false && config.ntfy?.enabled ? '\u2713' : '\u2717';
    log(`    ${event.padEnd(18)} toast ${toast}  ntfy ${ntfy}  sound: ${conf.sound || 'Default'}`);
  }

  // Non-blocking update check
  const latest = await checkForUpdate();
  if (latest) {
    log(`  Update available: v${pkg.version} \u2192 v${latest}`, 'yellow');
    log('  Run: npm i -g ai-agent-notifier@latest\n', 'yellow');
  } else {
    log('');
  }
}
