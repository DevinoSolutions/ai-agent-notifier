// src/platforms/windows.mjs
import { execFile } from 'node:child_process';
import { platform } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOAST_SCRIPT = path.join(__dirname, '..', '..', 'assets', 'windows', 'toast.ps1');

export async function sendToast(notification) {
  if (platform !== 'win32') return false;
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

    if (notification.cwd) {
      args.push('-Cwd', notification.cwd);
    }

    if (notification.source) {
      args.push('-Source', notification.source);
    }

    execFile('pwsh', args, { timeout: 15000 }, (err) => {
      resolve(!err);
    });
  });
}
