// scripts/tui/lib.mjs — minimal tmux control for driving real agent TUIs in CI.
// Uses the system tmux (brew-installed in the lane). Every helper shells out; no
// deps. Sensors: window_bell_flag and capture-pane.
import { execFileSync, spawnSync } from 'node:child_process';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function tmux(args, opts = {}) {
  return execFileSync('tmux', args, { encoding: 'utf8', ...opts });
}

export function tmuxSafe(args) {
  const r = spawnSync('tmux', args, { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// Create a detached session and launch `cmd` in a NON-active window, returning
// that window's REAL index as reported by tmux.
//
// Why we must READ the index instead of assuming 0: `new-session -d` creates the
// session's first window (an idle login shell) which stays the ACTIVE window;
// `new-window -d` then adds the agent window WITHOUT focusing it. The agent
// window is therefore the non-active one — exactly what we need, because tmux
// records `window_bell_flag` only for a window that is NOT the active/visible one
// (a bell in the active window is consumed by the attached client). The agent
// index is base-index + 1, and base-index can be 0 or 1 depending on the runner's
// tmux config, so hardcoding it is wrong. `-P -F '#{window_index}'` makes tmux
// print the created window's real index on stdout; we return it and every sensor
// (windowBellFlag / capturePane / sendKeys) is driven off it. (The prior code
// sensed window 0 — the idle shell — so it never saw the agent's bell or output.)
//
// monitor-bell must be enabled for the AGENT window specifically. Enabling it only
// on the session's current window does not propagate to a later-created window, so
// we set it as a GLOBAL window option before creating the window AND again on the
// agent window by index (belt and suspenders). `bell-action any` keeps tmux from
// suppressing the bell we are trying to observe.
export function newDetachedWindow(session, cmd) {
  tmux(['new-session', '-d', '-s', session, '-x', '200', '-y', '50']);
  tmux(['set-window-option', '-g', 'monitor-bell', 'on']); // window option, global default
  tmux(['set-option', '-g', 'bell-action', 'any']);        // session option, global default
  const index = tmux(['new-window', '-d', '-P', '-F', '#{window_index}', '-t', session, cmd]).trim();
  tmux(['set-window-option', '-t', `${session}:${index}`, 'monitor-bell', 'on']);
  return index;
}

export function windowBellFlag(session, windowIndex) {
  return tmux(['display-message', '-p', '-t', `${session}:${windowIndex}`, '#{window_bell_flag}']).trim();
}

export function capturePane(session, windowIndex) {
  return tmux(['capture-pane', '-p', '-t', `${session}:${windowIndex}`]);
}

// Send tmux key names (e.g. ['Enter'], ['Down'], ['y']) to a window.
export function sendKeys(session, windowIndex, keys) {
  tmux(['send-keys', '-t', `${session}:${windowIndex}`, ...keys]);
}

// Type literal text (no tmux key-name translation via -l), then submit with a
// separate Enter so the TUI receives it as one prompt.
export function sendPrompt(session, windowIndex, text) {
  tmux(['send-keys', '-t', `${session}:${windowIndex}`, '-l', text]);
  tmux(['send-keys', '-t', `${session}:${windowIndex}`, 'Enter']);
}

// Resolve an executable to an absolute path via which/where, falling back to the
// bare name (which relies on the child's inherited PATH). Used so the launched
// command does not depend on a login shell rebuilding PATH (macOS path_helper can
// drop the npm global bin under `bash -lc`).
export function resolveBin(name) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(finder, [name], { encoding: 'utf8' });
  const first = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  return first || name;
}

// One line per window: index, active flag, bell flag, name. Best-effort (never
// throws) so it is safe to call from a failure path.
export function listWindows(session) {
  const r = tmuxSafe(['list-windows', '-t', session, '-F',
    '#{window_index} active=#{window_active} bell=#{window_bell_flag} name=#{window_name}']);
  return (r.stdout || r.stderr || '(no windows)').trim();
}

// Full diagnostic dump for a session: the window table plus every window's pane
// content. This is the single most valuable thing to emit on a failure — a paid
// CI retry is expensive, so a failing proof must be debuggable from logs alone.
export function dumpSession(session) {
  const out = [`# tmux session '${session}':`, listWindows(session)];
  const r = tmuxSafe(['list-windows', '-t', session, '-F', '#{window_index}']);
  const indices = (r.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
  for (const idx of indices) {
    const cap = tmuxSafe(['capture-pane', '-p', '-t', `${session}:${idx}`]);
    out.push(`\n--- pane ${session}:${idx} ---\n${cap.stdout || cap.stderr || '(empty)'}`);
  }
  return out.join('\n');
}

export function killSession(session) {
  tmuxSafe(['kill-session', '-t', session]);
}
