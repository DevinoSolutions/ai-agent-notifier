// scripts/live-toast-windows.mjs — LAYER-2 delivery proof on Windows.
//
// The Windows analog of scripts/live-toast-macos.mjs. Fires a notification
// through our REAL Windows backend (src/platforms/windows.mjs → assets/windows/
// toast.ps1 → BurntToast) and asserts it was RECORDED by the Windows push-
// notification platform — not by trusting the toast script's exit code (which is
// 0 even when the toast is silently dropped). It reads the notification back out
// of the platform store, %LOCALAPPDATA%\Microsoft\Windows\Notifications\
// wpndatabase.db, and asserts our exact nonce is present in BOTH the title and
// body <text> elements of the recorded toast XML.
//
//   - no-false-positive guard: PRE-fire, the nonce must NOT already be in the store;
//   - positive gate: POST-fire, a recorded toast must contain the nonce in title + body.
// Both are hard failures.
//
// The store read is delegated to scripts/lib/wpn-readback.py (stdlib sqlite3,
// preinstalled on windows-latest). That reader is WAL-aware on purpose: a freshly
// fired toast lives in the -wal sidecar, and an immutable open would miss it.
//
// Requires (CI provides): windows-latest with the BurntToast module installed
// (the product path imports it) and Python (preinstalled). Raw evidence is written
// under RENDER_OUT for artifact upload.
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { route } from '../src/router.mjs';
import { loadConfig } from '../src/config-loader.mjs';
import { sendToast } from '../src/platforms/windows.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.RENDER_OUT || path.join(os.tmpdir(), 'win-readback-proof');
const READER = path.join(__dirname, 'lib', 'wpn-readback.py');

function fail(msg) { console.error(`FAIL [PRODUCT]: ${msg}`); process.exit(1); }
function infra(msg) { console.error(`FAIL [INFRA]: ${msg}`); process.exit(1); }

function nonce() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (const b of crypto.randomBytes(12)) s += alphabet[b % alphabet.length];
  return `AANWIN${s}`;
}

// Run the WPN store reader and return its parsed JSON verdict. Tries `python`
// then `python3` so it works on any windows-latest image.
function readStore(marker) {
  let last = null;
  for (const py of ['python', 'python3']) {
    const r = spawnSync(py, [READER, '--nonce', marker], { encoding: 'utf8', timeout: 20000 });
    if (r.error) { last = r.error.message; continue; }
    const stdout = (r.stdout || '').trim();
    if (!stdout) { last = `empty output from ${py} (stderr: ${(r.stderr || '').slice(0, 300)})`; continue; }
    try { return JSON.parse(stdout.split('\n').pop()); }
    catch (e) { last = `unparseable output from ${py}: ${stdout.slice(0, 300)}`; }
  }
  infra(`could not run WPN store reader: ${last}`);
  return null;
}

async function main() {
  if (os.platform() !== 'win32') infra('live-toast-windows is Windows-only.');

  mkdirSync(OUT, { recursive: true });
  const marker = nonce();
  writeFileSync(path.join(OUT, 'nonce.txt'), marker);
  console.log(`win-readback nonce=${marker}`);

  // No-false-positive guard: the nonce must not already be in the store.
  const pre = readStore(marker);
  writeFileSync(path.join(OUT, 'pre.json'), JSON.stringify(pre, null, 2));
  if (!pre.db_exists) {
    console.log('note: wpndatabase.db does not exist pre-fire (created on first toast) — guard trivially passes.');
  } else if (pre.found) {
    fail(`no-false-positive guard failed: nonce ${marker} already present in wpndatabase.db before firing.`);
  }
  console.log(`guard OK (pre-fire found=${pre.found}, db_exists=${pre.db_exists})`);

  // Fire a unique marker through the production backend, nonce in title + body.
  const config = loadConfig();
  const notification = route(
    { source: 'claude', event: 'needs_input', projectName: marker, cwd: 'C:/work/x' },
    config,
  );
  notification.title = `${notification.title} ${marker}`;
  console.log(`Firing via BurntToast: "${notification.title}" / "${notification.message}"`);

  const sent = await sendToast(notification);
  console.log(`sendToast returned: ${sent}`);
  // NOTE: we deliberately do NOT gate on `sent` — exit-0-but-not-recorded is the
  // exact bug this lane exists to catch. The store record is the real assertion.

  // Poll the store (the record appears within ~1s, but poll to absorb any lag).
  let res = null;
  for (let i = 1; i <= 10; i++) {
    res = readStore(marker);
    console.log(`poll ${i}: found=${res.found} title=${res.title_has_nonce} body=${res.body_has_nonce} strategy=${res.strategy}`);
    if (res.found) break;
    await sleep(1000);
  }
  writeFileSync(path.join(OUT, 'post.json'), JSON.stringify(res, null, 2));

  if (!res.found) {
    fail(`no wpndatabase.db record for nonce "${marker}" after firing (db_exists=${res.db_exists}). ` +
      `BurntToast returned ${sent} but nothing was recorded by the Windows notification platform.`);
  }
  if (!res.title_has_nonce || !res.body_has_nonce) {
    fail(`toast recorded but nonce missing from a <text> element ` +
      `(title=${res.title_has_nonce}, body=${res.body_has_nonce}); recorded texts: ${JSON.stringify(res.texts)}`);
  }

  console.log(`PASS (hard): toast recorded by the Windows notification platform with the exact payload.`);
  console.log(`  texts: ${JSON.stringify(res.texts)}`);
  console.log(`  recorded under AUMID: ${res.aumid}`);
  console.log(`  payload excerpt: ${res.payload_excerpt}`);
}

main();
