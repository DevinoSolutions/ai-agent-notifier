// scripts/live-toast-linux-render.mjs — LAYER-3 render proof on Linux.
//
// The sibling scripts/live-toast-linux.mjs proves the daemon *recorded* our
// exact title + body (layer 2). This goes one layer further: it proves the
// notification's text was legibly DRAWN AS PIXELS on a real X display and read
// back off the framebuffer. It starts dunst under a spike-tuned, PROJECT-OWNED
// dunstrc (large mono font, high contrast, no timeout) on a virtual display,
// fires the REAL Linux backend (src/platforms/linux.mjs → notify-send), captures
// the root window, and OCRs it with tesseract:
//   - no-false-positive guard: the PRE-fire frame must NOT contain the nonce;
//   - positive gate: a DURING-display frame MUST contain the nonce.
// Both are hard failures. The passing banner PNG is saved for artifact upload so
// a human can see the rendered notification.
//
// Because rendering uses OUR dunstrc on a virtual (Xvfb) display, this proves
// the product path draws readable pixels — not that every user's desktop theme
// renders identically.
//
// Must run with a session bus and a display, e.g. in CI:
//   xvfb-run -a dbus-run-session -- node scripts/live-toast-linux-render.mjs
//
// Requires: dunst, dbus-x11, xvfb, libnotify-bin, fonts-dejavu-core,
//           imagemagick (import/convert), tesseract-ocr, x11-apps (xwd fallback).
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { sendToast } from '../src/platforms/linux.mjs';
import { generateNonce, ocrContainsNonce } from './lib/ocr-nonce.mjs';

const OUT = process.env.RENDER_OUT || '/tmp/linux-render-proof';
const BANNER_PNG = path.join(OUT, 'render-banner.png');

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const pad = (n) => String(n).padStart(2, '0');

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

// A project-owned dunstrc tuned for OCR: big mono font, no expiry, wide banner,
// white-on-black, anchored top-right. This is OUR config on a virtual display —
// the claim is "the product path draws readable pixels", not "every theme does".
function writeDunstrc() {
  const rc = `[global]
    font = DejaVu Sans Mono 26
    frame_width = 3
    frame_color = "#FFFFFF"
    separator_color = frame
    sort = no
    idle_threshold = 0
    origin = top-right
    offset = 20x40
    width = 640
    height = 400
    notification_limit = 0
    padding = 24
    horizontal_padding = 24
    line_height = 4
    markup = no
    format = "%s\\n%b"
    alignment = left
    show_age_threshold = -1
    word_wrap = yes
    ignore_newline = no
    stack_duplicates = false
    show_indicators = no
    transparency = 0
    corner_radius = 0

[urgency_low]
    background = "#000000"
    foreground = "#FFFFFF"
    timeout = 0

[urgency_normal]
    background = "#000000"
    foreground = "#FFFFFF"
    timeout = 0

[urgency_critical]
    background = "#000000"
    foreground = "#FFFFFF"
    timeout = 0
`;
  const p = path.join(OUT, 'dunstrc');
  writeFileSync(p, rc);
  return p;
}

// Capture the X root window to a PNG. Prefer ImageMagick `import`; fall back to
// `xwd | convert`. DISPLAY comes from xvfb-run's env.
function capture(file) {
  const disp = process.env.DISPLAY || ':99';
  const imp = sh('import', ['-window', 'root', '-display', disp, file], { timeout: 8000 });
  if (imp.status === 0 && existsSync(file)) return true;
  const xwd = sh('bash', ['-lc', `xwd -root -display ${disp} | convert xwd:- ${file}`], { timeout: 8000 });
  return xwd.status === 0 && existsSync(file);
}

// OCR a PNG with tesseract; --psm 6 = assume a uniform block of text.
function ocr(file) {
  const r = sh('tesseract', [file, 'stdout', '--psm', '6'], { timeout: 15000 });
  if (r.status === 0) return r.stdout || '';
  const r2 = sh('tesseract', [file, 'stdout'], { timeout: 15000 });
  return r2.status === 0 ? (r2.stdout || '') : '';
}

async function main() {
  if (os.platform() !== 'linux') fail('render proof is Linux-only.');
  if (!process.env.DBUS_SESSION_BUS_ADDRESS) {
    fail('no DBUS_SESSION_BUS_ADDRESS — run under `dbus-run-session`.');
  }
  if (!process.env.DISPLAY) fail('no DISPLAY — run under `xvfb-run`.');

  mkdirSync(OUT, { recursive: true });
  const nonce = generateNonce();
  writeFileSync(path.join(OUT, 'nonce.txt'), nonce);
  console.log(`render-proof nonce=${nonce} DISPLAY=${process.env.DISPLAY}`);

  const rcPath = writeDunstrc();
  const dunst = spawn('dunst', ['-config', rcPath], { stdio: 'ignore' });
  dunst.on('error', (err) => fail(`could not start dunst: ${err.message}`));

  // Wait for dunst to own org.freedesktop.Notifications (dunstctl succeeds once
  // it's up). dunst logs a benign "Cannot acquire ..." line as the transient
  // dbus autolaunch instance loses the name to the real dunst — not a failure.
  let ready = false;
  for (let i = 0; i < 40; i++) {
    if (sh('dunstctl', ['is-paused']).status === 0) { ready = true; break; }
    await sleep(250);
  }
  if (!ready) { dunst.kill(); fail('dunst did not become ready within 10s.'); }
  console.log('dunst is up and owns org.freedesktop.Notifications');

  // --- No-false-positive guard: pre-fire frame must NOT contain the nonce. ---
  const preFile = path.join(OUT, 'frame-pre.png');
  if (!capture(preFile)) { dunst.kill(); fail('could not capture the pre-fire frame.'); }
  const preOcr = ocr(preFile);
  writeFileSync(path.join(OUT, 'frame-pre.txt'), preOcr);
  if (ocrContainsNonce(preOcr, nonce)) {
    dunst.kill();
    fail(`nonce ${nonce} already present in the pre-fire frame — capture/OCR is not trustworthy.`);
  }
  console.log('pre-fire guard passed: nonce absent before firing');

  // --- Fire the REAL product backend. linux.sendToast keys off `priority`
  // (mapped through URGENCY_MAP), not `urgency`. ---
  const notification = {
    title: 'AI Agent Notifier',
    message: `RENDER ${nonce}`,
    priority: 'high',
    source: 'claude',
  };
  const delivered = await sendToast(notification);
  if (!delivered) { dunst.kill(); fail('linux sendToast returned false (notify-send did not exit 0).'); }
  console.log(`fired via notify-send: "${notification.title}" / "${notification.message}"`);

  // --- Positive gate: a during-display frame MUST contain the nonce. Retry a
  // handful of frames over ~5s to absorb render/capture timing. ---
  const N = 8;
  let hitFrame = null;
  for (let i = 0; i < N; i++) {
    await sleep(600);
    const f = path.join(OUT, `frame-${pad(i)}.png`);
    if (!capture(f)) { console.log(`frame ${pad(i)}: capture failed`); continue; }
    const text = ocr(f);
    writeFileSync(path.join(OUT, `frame-${pad(i)}.txt`), text);
    const hit = ocrContainsNonce(text, nonce);
    console.log(`frame ${pad(i)}: nonceHit=${hit}`);
    if (hit) { hitFrame = f; break; }
  }

  // Move any displayed notification into history for the artifact record.
  sh('dunstctl', ['close-all']);
  const hist = sh('dunstctl', ['history']);
  writeFileSync(path.join(OUT, 'dunst-history.json'), hist.stdout || hist.stderr || '(no output)');

  dunst.kill();

  if (!hitFrame) {
    fail(`nonce ${nonce} never appeared in any during-display frame's OCR — the banner did not render legibly.`);
  }

  copyFileSync(hitFrame, BANNER_PNG);
  console.log(`PASS (hard): notification text rendered as legible pixels on X — nonce ${nonce} OCR-read from ${path.basename(hitFrame)}`);
  console.log(`banner saved to ${BANNER_PNG}`);
  process.exit(0);
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
