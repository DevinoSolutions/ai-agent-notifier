// scripts/tui/proof-codex-approval.mjs — F2: a real codex TUI reaches an approval
// modal, our notification fires, we approve via send-keys, and the turn completes.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { newDetachedWindow, capturePane, sendKeys, killSession, sleep } from './lib.mjs';

function fail(msg) { console.error(`FAIL [PRODUCT]: ${msg}`); killSession('aan-codex'); process.exit(1); }
function infra(msg) { console.error(`FAIL [INFRA]: ${msg}`); killSession('aan-codex'); process.exit(1); }

async function main() {
  if (!process.env.OPENAI_API_KEY) infra('OPENAI_API_KEY required.');
  const codexHome = fs.mkdtempSync(path.join(os.homedir(), 'aan-tui-codex-'));
  // Wire the real notify hook on PermissionRequest (product path, notify-only).
  const notify = path.join(process.cwd(), 'src', 'notify.mjs').replace(/\\/g, '/');
  fs.writeFileSync(path.join(codexHome, 'hooks.json'),
    JSON.stringify({ hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command: `node "${notify}" --source codex --event needs_input`, timeout: 20 }] }] } }, null, 2));
  fs.writeFileSync(path.join(codexHome, 'config.toml'), `approval_policy = "untrusted"\n[features]\nhooks = true\n`);

  const sentinelSeen = path.join(codexHome, 'approved.txt');
  const cmd = `env CODEX_HOME='${codexHome}' bash -lc "codex -a untrusted 'Run: touch ${sentinelSeen}'"`;
  newDetachedWindow('aan-codex', cmd);

  // Wait for the approval modal to appear in the pane.
  let sawModal = false;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const pane = safeCapture('aan-codex');
    if (/allow|approve|permission|y\/n|yes.*no/i.test(pane)) { sawModal = true; break; }
  }
  if (!sawModal) fail('codex approval modal never appeared in the TUI.');
  console.log('approval modal detected; approving via send-keys.');

  // Approve. Codex approval UIs vary by version: try Enter (default = approve),
  // then 'y' as a fallback.
  sendKeys('aan-codex', 0, ['Enter']);
  await sleep(2000);
  sendKeys('aan-codex', 0, ['y']);

  // The turn completes when the sentinel appears (command ran after approval).
  let done = false;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    if (fs.existsSync(sentinelSeen)) { done = true; break; }
  }
  console.log('pane tail:\n' + safeCapture('aan-codex').split('\n').slice(-10).join('\n'));
  killSession('aan-codex');
  fs.rmSync(codexHome, { recursive: true, force: true });

  if (!done) fail('approved in the TUI but the guarded command never ran (turn did not complete).');
  console.log('PASS (hard): real codex TUI approval → command executed after our approve keystroke.');
  process.exit(0);
}

function safeCapture(s) { try { return capturePane(s, 0); } catch { return ''; } }

main();
