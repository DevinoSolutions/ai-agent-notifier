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

// Create a detached session running `cmd` in a NON-active window (bell flags
// record reliably only when the window is not the active one).
export function newDetachedWindow(session, cmd) {
  tmux(['new-session', '-d', '-s', session, '-x', '200', '-y', '50']);
  tmux(['set-option', '-t', session, 'monitor-bell', 'on']);
  tmux(['set-window-option', '-t', session, 'monitor-bell', 'on']);
  // Second window becomes active, leaving the agent window unfocused.
  tmux(['new-window', '-d', '-t', session, cmd]);
}

export function windowBellFlag(session, windowIndex = 0) {
  return tmux(['display-message', '-p', '-t', `${session}:${windowIndex}`, '#{window_bell_flag}']).trim();
}

export function capturePane(session, windowIndex = 0) {
  return tmux(['capture-pane', '-p', '-t', `${session}:${windowIndex}`]);
}

export function sendKeys(session, windowIndex, keys) {
  tmux(['send-keys', '-t', `${session}:${windowIndex}`, ...keys]);
}

export function killSession(session) {
  tmuxSafe(['kill-session', '-t', session]);
}
