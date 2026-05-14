// src/platforms/macos.mjs
import { execFile } from 'node:child_process';

export function sendToast(notification) {
  return new Promise((resolve) => {
    const sound = notification.sound || 'default';
    const script = `display notification "${esc(notification.message)}" with title "${esc(notification.title)}" sound name "${esc(sound)}"`;

    execFile('osascript', ['-e', script], { timeout: 5000 }, (err) => {
      resolve(!err);
    });
  });
}

function esc(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
