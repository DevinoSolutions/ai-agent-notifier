// cli/status.mjs
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadConfigResult } from '../src/config-loader.mjs';
import { readRecentHookErrors, getErrorLogPath } from '../src/error-log.mjs';
import { detectManagedEvents } from '../setup/patch-config.mjs';
import { checkForUpdate } from './update-check.mjs';
import { c, box, kv, sectionHeader } from './ui.mjs';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

// Webhook URLs are secrets (Slack/Discord tokens, Telegram bot token in the
// path), so status shows the origin only — never the full URL.
function webhookOrigin(url) {
  try { return new URL(url).origin; } catch { return 'invalid URL'; }
}

// Wired-state detection uses the SAME predicate as the patcher (detectManagedEvents),
// so every shape we write — including Cursor's flat { command } entries — is
// recognised here. Never throws: an unreadable/corrupt tool config reads as an error.
function checkTool(dirName, label, configFile) {
  const filePath = path.join(os.homedir(), dirName, configFile);
  if (!fs.existsSync(filePath)) return { label, status: 'not installed', events: [] };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return { label, status: 'config error', events: [] };
  }
  const events = detectManagedEvents(data.hooks || {});
  return { label, status: events.length > 0 ? 'wired' : 'not wired', events };
}

export async function run() {
  const { config, problem } = loadConfigResult();
  if (problem) {
    console.error(`  ${c.error('Config error:')} ${problem.message}`);
    process.exitCode = 1;
    return;
  }

  const platform = os.platform();
  const platLabel = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux';
  const toastLabel = platform === 'win32' ? 'BurntToast' : platform === 'darwin' ? 'osascript' : 'notify-send';
  const toastExtra = config.toast?.clickToFocus ? c.muted(' (click-to-focus)') : '';

  const ntfyValue = config.ntfy?.enabled && config.ntfy?.topic
    ? c.success(`${config.ntfy.server}/${config.ntfy.topic}`)
    : c.muted('disabled');
  const sentryValue = config.sentry?.enabled ? c.success('enabled') : c.muted('disabled');

  // Tools
  const tools = [
    checkTool('.claude', 'Claude Code', 'settings.json'),
    checkTool('.codex', 'Codex CLI', 'hooks.json'),
    checkTool('.cursor', 'Cursor IDE', 'hooks.json'),
    checkTool('.gemini', 'Gemini CLI', 'settings.json'),
  ];

  const toolLines = tools.map(t => {
    const icon = t.status === 'wired' ? c.success('✓') : c.muted('✗');
    const name = t.status === 'wired' ? c.white(t.label) : c.muted(t.label);
    const events = t.status === 'wired'
      ? c.muted(` ${t.events.join(', ')}`)
      : c.muted(` ${t.status}`);
    return `${icon} ${name}${events}`;
  });

  // Events
  const eventLines = Object.entries(config.events || {}).map(([event, conf]) => {
    const toastIcon = conf.toastEnabled !== false ? c.success('✓') : c.muted('✗');
    const ntfyIcon = conf.ntfyEnabled !== false && config.ntfy?.enabled ? c.success('✓') : c.muted('✗');
    const name = c.white(event.padEnd(16));
    const sound = c.muted(conf.toastSound || 'Default');
    return `${name} toast ${toastIcon}  ntfy ${ntfyIcon}  ${sound}`;
  });

  // Build box content
  const lines = [
    c.bold(`ai-agent-notifier ${c.accent(`v${pkg.version}`)}`),
    '',
    kv('Platform', platLabel),
    kv('Toast', `${toastLabel}${toastExtra}`),
    kv('Sentry', sentryValue),
    kv('ntfy', ''),
    `${''.padEnd(15)} ${ntfyValue}`,
    ...(config.webhook?.enabled && config.webhook?.url
      ? [kv('Webhook', c.success(webhookOrigin(config.webhook.url)))]
      : []),
    '---',
    sectionHeader('Tools'),
    ...toolLines,
    '---',
    sectionHeader('Events'),
    ...eventLines,
  ];

  console.log();
  console.log(box(lines, { padding: 2, width: 52 }));

  // Recent hook errors — the hook path never crashes the host agent, so this is
  // where silent failures surface.
  const errors = readRecentHookErrors(8);
  console.log();
  if (errors.length === 0) {
    console.log(`  ${c.success('✓')} ${c.muted('no recent hook errors')}`);
  } else {
    console.log(`  ${c.warn('⚠')} ${c.warn(`${errors.length} recent hook error${errors.length === 1 ? '' : 's'}`)}`);
    for (const e of errors) {
      const firstLine = String(e.message || '').split('\n')[0];
      console.log(`    ${c.muted(e.ts || '')} ${c.white(e.context || '')}  ${c.muted(firstLine)}`);
    }
    console.log(`    ${c.muted('see')} ${c.white(getErrorLogPath())}`);
  }

  // Update check (shares the memoized, cached result with index.mjs)
  const latest = await checkForUpdate();
  if (latest) {
    console.log();
    console.log(`  ${c.warn('↑')} ${c.warn(`Update available: v${pkg.version} → v${latest}`)}`);
    console.log(`    ${c.muted('npm i -g ai-agent-notifier@latest')}`);
  }
  console.log();
}
