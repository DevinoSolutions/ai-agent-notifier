// src/platforms/macos.mjs
import { execFile } from 'node:child_process';
import { logHookError } from '../error-log.mjs';

export function sendToast(notification) {
  return new Promise((resolve) => {
    const sound = notification.toastSound || 'default';
    const script = `display notification "${esc(notification.message)}" with title "${esc(notification.title)}" sound name "${esc(sound)}"`;

    execFile('osascript', ['-e', script], { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) logHookError('toast:macos', err, { stderr: (stderr || '').slice(0, 400) });
      resolve(!err);
    });
  });
}

// Escape for embedding inside a double-quoted AppleScript string literal.
// Control characters are replaced with spaces: they cannot be escaped
// portably and a raw newline would otherwise break out of the string.
export function esc(str) {
  return (str || '')
    .replace(new RegExp('[\\x00-\\x1f\\x7f]', 'g'), ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}
