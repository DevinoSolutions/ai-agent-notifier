// scripts/toast-demo.mjs — fire REAL native desktop notifications so a human can
// visually confirm the toast actually appears on Windows / macOS / Linux.
//
// This is the manual counterpart to the automated coverage:
//   - tests/platforms.test.mjs (AAN_TOAST_LIVE=1) asserts each backend returns
//     true when fired on its own OS.
//   - scripts/live-toast-linux.mjs asserts the Linux notify-send payload is
//     actually captured by a real notification daemon (dunst) in CI.
// Headless CI can prove "delivered/return true" but never "a human saw it" —
// that's what this script is for. Run it on a real desktop:
//
//   npm run toast:demo                 # every source, both event styles
//   npm run toast:demo -- --source claude
//   npm run toast:demo -- --event needs_input --delay 2500
//
// Each toast uses the real router output and the real per-OS backend, so what
// you see here is exactly what an agent hook produces in production.
import os from 'node:os';
import { route } from '../src/router.mjs';
import { loadConfig } from '../src/config-loader.mjs';
import { resolveToastBackend } from '../src/platforms/index.mjs';

const SOURCES = ['claude', 'codex', 'gemini', 'cursor'];
// session_start is toast-suppressed by default config, so it's not a useful
// visual demo; task_complete + needs_input are the two styles users actually see.
const EVENTS = ['task_complete', 'needs_input'];

function parseArgs(argv) {
  const args = { source: null, event: null, delay: 1800 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--source' && argv[i + 1]) { args.source = argv[++i]; }
    else if (argv[i] === '--event' && argv[i + 1]) { args.event = argv[++i]; }
    else if (argv[i] === '--delay' && argv[i + 1]) { args.delay = Number(argv[++i]) || 1800; }
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = parseArgs(process.argv);
  const platform = os.platform();
  const backend = platform === 'win32' ? 'windows.mjs (BurntToast)'
    : platform === 'darwin' ? 'macos.mjs (osascript)'
      : 'linux.mjs (notify-send)';

  const config = loadConfig(); // real merged config (defaults + ~/.anotifier)
  const sendToast = await resolveToastBackend();

  const sources = args.source ? [args.source] : SOURCES;
  const events = args.event ? [args.event] : EVENTS;

  console.log(`Toast demo on ${platform} via ${backend}`);
  console.log(`Firing ${sources.length * events.length} real notification(s) — watch your desktop.\n`);

  let ok = 0;
  let total = 0;
  for (const source of sources) {
    for (const event of events) {
      total++;
      const notification = route(
        { source, event, projectName: 'demo-project', cwd: process.cwd() },
        config,
      );
      if (!notification) {
        console.log(`  SKIP ${source}/${event}: route() returned null (suppressed)`);
        continue;
      }
      const delivered = await sendToast(notification);
      if (delivered) ok++;
      console.log(`  ${delivered ? 'OK  ' : 'FAIL'} ${source}/${event}: "${notification.title}" — ${notification.message}`);
      await sleep(args.delay);
    }
  }

  console.log(`\n${ok}/${total} backend calls returned true.`);
  if (ok < total) {
    console.log('Note: a false result means the backend command failed (e.g. notify-send/');
    console.log('BurntToast not installed). A true result means it was handed to the OS —');
    console.log('confirm visually that the toast actually appeared.');
  }
  process.exit(0);
}

main();
