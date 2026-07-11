// scripts/tui/proof-bell.mjs — F1: a real claude TUI, terminal bell enabled,
// must set the tmux window_bell_flag (proves the bell reaches the terminal).
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { newDetachedWindow, windowBellFlag, capturePane, killSession, sleep } from './lib.mjs';

function fail(msg) { console.error(`FAIL [PRODUCT]: ${msg}`); killSession('aan-bell'); process.exit(1); }
function infra(msg) { console.error(`FAIL [INFRA]: ${msg}`); killSession('aan-bell'); process.exit(1); }

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) infra('ANTHROPIC_API_KEY required.');
  // Isolated home wired to notify with terminalBell enabled.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-tui-bell-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{}\n');
  fs.mkdirSync(path.join(home, '.ai-agent-notifier'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ai-agent-notifier', 'config.json'),
    JSON.stringify({ toast: { enabled: false }, ntfy: { enabled: false }, terminalBell: { enabled: true } }) + '\n');

  const repo = process.cwd();
  await execWire(home, repo);

  const cmd = `env HOME='${home}' USERPROFILE='${home}' bash -lc "claude -p 'Reply with the single word OK.'; sleep 2"`;
  newDetachedWindow('aan-bell', cmd);

  // Poll the bell flag for up to 90s (claude cold start + turn).
  let flag = '0';
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    try { flag = windowBellFlag('aan-bell', 0); } catch { /* window may be starting */ }
    if (flag === '1') break;
  }
  console.log('pane tail:\n' + capturePane('aan-bell', 0).split('\n').slice(-8).join('\n'));
  killSession('aan-bell');
  fs.rmSync(home, { recursive: true, force: true });

  if (flag !== '1') fail('window_bell_flag never became 1 — claude TUI did not ring the terminal bell.');
  console.log('PASS (hard): real claude TUI rang the terminal bell (window_bell_flag=1).');
  process.exit(0);
}

// Wire notify hooks into the isolated home by running the real setup patcher.
async function execWire(home, repo) {
  const { patchClaude } = await import(path.join(repo, 'setup', 'patch-config.mjs'));
  patchClaude(path.join(home, '.claude'), path.join(repo, 'src', 'notify.mjs'));
}

main();
