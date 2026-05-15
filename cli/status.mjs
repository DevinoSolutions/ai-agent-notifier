// cli/status.mjs
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadConfig } from '../src/config-loader.mjs';
import { checkForUpdate } from './index.mjs';
import { c, box, kv, sectionHeader, table } from './ui.mjs';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

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
  const toastExtra = config.toast?.clickToFocus ? c.muted(' (click-to-focus)') : '';

  const ntfyValue = config.ntfy?.enabled && config.ntfy?.topic
    ? c.success(`${config.ntfy.server}/${config.ntfy.topic}`)
    : c.muted('disabled');

  // Tools
  const tools = [
    checkTool('.claude', 'Claude Code', 'settings.json'),
    checkTool('.codex', 'Codex CLI', 'hooks.json'),
    checkTool('.cursor', 'Cursor IDE', 'hooks.json'),
    checkTool('.gemini', 'Gemini CLI', 'hooks.json'),
  ];

  const toolLines = tools.map(t => {
    const icon = t.status === 'wired' ? c.success('\u2713') : c.muted('\u2717');
    const name = t.status === 'wired' ? c.white(t.label) : c.muted(t.label);
    const events = t.status === 'wired'
      ? c.muted(` ${t.events.join(', ')}`)
      : c.muted(` ${t.status}`);
    return `${icon} ${name}${events}`;
  });

  // Events
  const eventLines = Object.entries(config.events || {}).map(([event, conf]) => {
    const toastIcon = conf.toastEnabled !== false ? c.success('\u2713') : c.muted('\u2717');
    const ntfyIcon = conf.ntfyEnabled !== false && config.ntfy?.enabled ? c.success('\u2713') : c.muted('\u2717');
    const name = c.white(event.padEnd(16));
    const sound = c.muted(conf.sound || 'Default');
    return `${name} toast ${toastIcon}  ntfy ${ntfyIcon}  ${sound}`;
  });

  // Build box content
  const lines = [
    c.bold(`ai-agent-notifier ${c.accent(`v${pkg.version}`)}`),
    '',
    kv('Platform', platLabel),
    kv('Toast', `${toastLabel}${toastExtra}`),
    kv('ntfy', ''),
    `${''.padEnd(15)} ${ntfyValue}`,
    '---',
    sectionHeader('Tools'),
    ...toolLines,
    '---',
    sectionHeader('Events'),
    ...eventLines,
  ];

  console.log();
  console.log(box(lines, { padding: 2, width: 52 }));

  // Non-blocking update check
  const latest = await checkForUpdate();
  if (latest) {
    console.log();
    console.log(`  ${c.warn('\u2191')} ${c.warn(`Update available: v${pkg.version} \u2192 v${latest}`)}`);
    console.log(`    ${c.muted('npm i -g ai-agent-notifier@latest')}`);
  }
  console.log();
}
