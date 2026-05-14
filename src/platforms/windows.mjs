// src/platforms/windows.mjs
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOAST_SCRIPT = path.join(__dirname, '..', '..', 'assets', 'windows', 'toast.ps1');

export function sendToast(notification) {
  return new Promise((resolve) => {
    const args = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TOAST_SCRIPT,
      '-Title', notification.title,
      '-Message', notification.message,
      '-Sound', notification.sound || 'Default',
    ];

    if (notification.projectName) {
      args.push('-ProjectName', notification.projectName);
    }

    execFile('pwsh', args, { timeout: 10000 }, (err) => {
      resolve(!err);
    });
  });
}
