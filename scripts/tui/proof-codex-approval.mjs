// scripts/tui/proof-codex-approval.mjs — F2: a real codex TUI reaches an approval
// modal, our PermissionRequest notification fires, we approve via send-keys, and
// the guarded command runs (sentinel appears).
//
// This is the ONLY lane that proves the codex approval DECISION loop end to end.
// The exec lane (scripts/live-codex.mjs) structurally cannot: non-interactive
// `codex exec` has no TTY to prompt on, so it forces approval:never + a read-only
// sandbox and PermissionRequest never fires. Interactive TUI + `-a untrusted` is
// the deterministic way to surface the modal.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {
  newDetachedWindow, capturePane, sendKeys, resolveBin, killSession, dumpSession, sleep,
} from './lib.mjs';

const SESSION = 'aan-codex';

function diagnose(label) {
  console.error(`\n===== F2 DIAGNOSTICS (${label}) =====`);
  console.error(dumpSession(SESSION));
  console.error('===== END F2 DIAGNOSTICS =====\n');
}
// Leave the session alive on failure so the workflow always() diag step can also
// dump it; we already printed a full dump here.
function fail(msg) { console.error(`FAIL [PRODUCT]: ${msg}`); diagnose('product-fail'); process.exit(1); }
function infra(msg) { console.error(`FAIL [INFRA]: ${msg}`); process.exit(1); }

async function main() {
  if (!process.env.OPENAI_API_KEY) infra('OPENAI_API_KEY required.');

  // CODEX_HOME must live under the REAL home — codex refuses to create its helper
  // binaries under a temp dir (see scripts/lib/live-driver.mjs and repo memory).
  const codexHome = fs.mkdtempSync(path.join(os.homedir(), 'aan-tui-codex-'));
  // Wire the real product notify hook on PermissionRequest (notify-only path).
  const notify = path.join(process.cwd(), 'src', 'notify.mjs').replace(/\\/g, '/');
  fs.writeFileSync(path.join(codexHome, 'hooks.json'),
    JSON.stringify({ hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command: `node "${notify}" --source codex --event needs_input`, timeout: 20 }] }] } }, null, 2));
  // untrusted policy forces the approval modal for a write; enable hooks.
  fs.writeFileSync(path.join(codexHome, 'config.toml'), 'approval_policy = "untrusted"\n[features]\nhooks = true\n');

  // codex runs from this dir; the guarded command creates the sentinel here.
  const workDir = fs.mkdtempSync(path.join(codexHome, 'work-'));
  const sentinel = path.join(workDir, 'approved.txt').replace(/\\/g, '/');
  const codexBin = resolveBin('codex');

  // Launch the REAL interactive codex TUI in a NON-active window. `bash -c` (not
  // -lc) keeps the inherited PATH; we pass codex's absolute path for good measure.
  const cmd = `env CODEX_HOME='${codexHome}' bash -c "cd '${workDir}' && exec '${codexBin}' -a untrusted 'Run this shell command: touch ${sentinel}'"`;
  const win = newDetachedWindow(SESSION, cmd);
  console.log(`F2: agent window = ${SESSION}:${win} (codex bin: ${codexBin})`);

  // Codex first-run onboarding can gate the session before any approval modal:
  // trust-this-folder (Enter) then sandbox-mode selection (Down, Enter for the
  // non-admin option). Send that proven sequence early and defensively — if a
  // prompt isn't shown the keys no-op. (repo memory tui-proof-harness, codex 0.144.)
  await sleep(4000);
  console.log(`F2: pane after 4s (first-run window):\n${tail(safeCapture(win), 20)}`);
  sendKeys(SESSION, win, ['Enter']);
  await sleep(1500);
  sendKeys(SESSION, win, ['Down']);
  await sleep(500);
  sendKeys(SESSION, win, ['Enter']);

  // Wait for the approval modal (widened phrasing for codex 0.144.0).
  let sawModal = false;
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    const pane = safeCapture(win);
    if (isApprovalModal(pane)) { sawModal = true; break; }
    if (i === 30) console.log(`F2: 30s, no modal yet. pane:\n${tail(pane, 15)}`);
    if (i === 75) console.log(`F2: 75s, no modal yet. pane:\n${tail(pane, 15)}`);
  }
  if (!sawModal) fail('codex approval modal never appeared in the TUI.');
  console.log(`F2: approval modal detected. pane:\n${tail(safeCapture(win), 20)}`);
  console.log('F2: approving via send-keys.');

  // Approve. codex 0.144 approval modals accept the highlighted Yes/Approve via
  // Enter; try '1' (numbered choice) and 'y' as fallbacks for other key handling.
  sendKeys(SESSION, win, ['Enter']);
  await sleep(1500);
  sendKeys(SESSION, win, ['1']);
  await sleep(500);
  sendKeys(SESSION, win, ['y']);

  // Turn completes when the sentinel appears (guarded command ran after approval).
  let done = false;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    if (fs.existsSync(sentinel)) { done = true; break; }
  }
  console.log(`F2: pane tail:\n${tail(safeCapture(win), 15)}`);

  if (!done) fail('approved in the TUI but the guarded command never ran (turn did not complete).');

  killSession(SESSION);
  fs.rmSync(codexHome, { recursive: true, force: true });
  console.log('PASS (hard): real codex TUI approval → command executed after our approve keystroke.');
  process.exit(0);
}

// Match the codex approval modal across phrasings/versions.
function isApprovalModal(pane) {
  if (!pane) return false;
  return /allow|approve|permission|do you want|proceed\?|run command|wants to run|y\/n|yes.*no|❯.*yes|\b1\.\s*yes/i.test(pane);
}
function tail(s, n) { return String(s || '').split('\n').slice(-n).join('\n'); }
function safeCapture(win) { try { return capturePane(SESSION, win); } catch { return ''; } }

main();
