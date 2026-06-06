// scripts/live-toast-linux.mjs — REAL native notification capture on Linux.
//
// This is the strongest automated toast assertion we can make headlessly: it
// runs a real notification daemon (dunst), fires a notification through our
// actual Linux backend (src/platforms/linux.mjs → notify-send), and then reads
// the daemon's history to assert the notification was delivered with the exact
// title and body the router produced. Unlike "did sendToast return true", this
// proves the payload reached a real org.freedesktop.Notifications service.
//
// Must run with a session bus and a display, e.g. in CI:
//   xvfb-run -a dbus-run-session -- node scripts/live-toast-linux.mjs
//
// Requires: dunst, libnotify-bin (notify-send), dbus-x11, xvfb.
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { route } from '../src/router.mjs';
import { loadConfig } from '../src/config-loader.mjs';
import { sendToast } from '../src/platforms/linux.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sh(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8' });
}

// dunst writes a notification to its history once it's closed/expired. Move any
// currently-displayed notifications into history, then parse it for our token.
function historyContains(token) {
  sh('dunstctl', ['close-all']);
  const res = sh('dunstctl', ['history']);
  if (res.status !== 0) return { found: false, raw: res.stderr || '' };
  let parsed;
  try { parsed = JSON.parse(res.stdout); } catch { return { found: false, raw: res.stdout }; }
  const items = parsed?.data?.[0] || [];
  for (const n of items) {
    const body = n?.body?.data || '';
    const summary = n?.summary?.data || '';
    if (body.includes(token) || summary.includes(token)) {
      return { found: true, summary, body };
    }
  }
  return { found: false, raw: res.stdout };
}

async function main() {
  if (os.platform() !== 'linux') {
    console.error('FAIL: live-toast-linux is Linux-only.');
    process.exit(1);
  }
  if (!process.env.DBUS_SESSION_BUS_ADDRESS) {
    console.error('FAIL: no DBUS_SESSION_BUS_ADDRESS — run under `dbus-run-session`.');
    process.exit(1);
  }

  // Start the real notification daemon. It claims org.freedesktop.Notifications
  // on the session bus; notify-send then routes to it.
  const dunst = spawn('dunst', [], { stdio: 'ignore' });
  dunst.on('error', (err) => {
    console.error('FAIL: could not start dunst:', err.message);
    process.exit(1);
  });

  // Wait for dunst to own the bus name (dunstctl succeeds once it's up).
  let ready = false;
  for (let i = 0; i < 40; i++) {
    if (sh('dunstctl', ['is-paused']).status === 0) { ready = true; break; }
    await sleep(250);
  }
  if (!ready) {
    console.error('FAIL: dunst did not become ready within 10s.');
    dunst.kill();
    process.exit(1);
  }
  console.log('dunst is up and owns org.freedesktop.Notifications');

  // Fire a real notification through the production backend. A unique token in
  // the project name flows into the message body so we can match it precisely.
  const token = `aan-${process.pid}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  const config = loadConfig();
  const notification = route(
    { source: 'claude', event: 'needs_input', projectName: token, cwd: '/work/x' },
    config,
  );
  console.log(`Firing via notify-send: "${notification.title}" / "${notification.message}"`);

  const delivered = await sendToast(notification);
  if (!delivered) {
    console.error('FAIL: linux sendToast returned false (notify-send did not exit 0).');
    dunst.kill();
    process.exit(1);
  }
  console.log('PASS (hard): notify-send exited 0');

  // Poll the daemon's history for our exact payload.
  let hit = null;
  for (let i = 0; i < 12; i++) {
    const r = historyContains(token);
    if (r.found) { hit = r; break; }
    await sleep(500);
  }

  dunst.kill();

  if (!hit) {
    console.error('FAIL: dunst never recorded our notification — daemon did not receive the payload.');
    process.exit(1);
  }

  // Assert the captured payload matches what the router produced.
  if (hit.summary !== notification.title) {
    console.error(`FAIL: captured summary "${hit.summary}" != expected "${notification.title}"`);
    process.exit(1);
  }
  if (hit.body !== notification.message) {
    console.error(`FAIL: captured body "${hit.body}" != expected "${notification.message}"`);
    process.exit(1);
  }

  console.log(`PASS (hard): dunst captured the notification — summary="${hit.summary}" body="${hit.body}"`);
  console.log('A real notification daemon received the exact title + body our backend sent.');
  process.exit(0);
}

main();
