// scripts/live-toast-macos.mjs — REAL native notification capture on macOS.
//
// The macOS analog of live-toast-linux.mjs. Fires a notification through our
// actual macOS backend (src/platforms/macos.mjs → osascript) and asserts it was
// DELIVERED by reading Notification Center's SQLite DB — not by trusting the
// osascript exit code (which is 0 even when the banner is silently dropped).
//
// Requires (CI provides): macos-15, SIP disabled, an FDA self-grant so the DB is
// readable, and authorization seeded so the notification actually records.
import os from 'node:os';
import { route } from '../src/router.mjs';
import { loadConfig } from '../src/config-loader.mjs';
import { sendToast } from '../src/platforms/macos.mjs';
import { verifyDelivery, ncDbPath, notificationAuthState } from '../src/platforms/macos-delivery.mjs';

function fail(msg) { console.error(`FAIL [PRODUCT]: ${msg}`); process.exit(1); }
function infra(msg) { console.error(`FAIL [INFRA]: ${msg}`); process.exit(1); }

async function main() {
  if (os.platform() !== 'darwin') infra('live-toast-macos is macOS-only.');

  const dbPath = ncDbPath();
  if (!dbPath) infra('Notification Center DB not found — check macOS version / FDA grant.');
  console.log(`NC DB: ${dbPath}`);
  console.log(`auth state (pre-send): ${JSON.stringify(notificationAuthState())}`);

  // Fire a unique marker through the production backend.
  const marker = `aan-mac-${process.pid}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  const config = loadConfig();
  const notification = route(
    { source: 'claude', event: 'needs_input', projectName: marker, cwd: '/work/x' },
    config,
  );
  console.log(`Firing via osascript: "${notification.title}" / "${notification.message}"`);

  const sent = await sendToast(notification);
  console.log(`sendToast returned: ${sent}`);
  // NOTE: we deliberately do NOT gate on `sent` — exit-0-but-invisible is the
  // exact bug this lane exists to catch. The DB record is the real assertion.

  const res = await verifyDelivery(marker, { timeoutMs: 30000, pollMs: 1000 });
  if (!res.delivered) {
    if (res.reason === 'tcc-blocked') infra('NC DB unreadable (TCC) — FDA grant did not take.');
    fail(`no Notification Center delivery record for marker "${marker}" (${res.reason}). osascript exited but nothing was delivered.`);
  }

  // Assert exact content the router produced (marker is inside the message).
  if (!res.record.body.includes(marker)) {
    fail(`delivery record body "${res.record.body}" does not contain marker "${marker}"`);
  }
  console.log(`PASS: delivered + verified — title="${res.record.title}" body="${res.record.body}" app="${res.record.app}"`);
  console.log('A real notification reached Notification Center with the exact payload our backend sent.');
  process.exit(0);
}

main();
