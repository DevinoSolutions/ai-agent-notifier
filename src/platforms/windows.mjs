// src/platforms/windows.mjs
import { execFile } from 'node:child_process';
import { platform } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logHookError } from '../error-log.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOAST_SCRIPT = path.join(__dirname, '..', '..', 'assets', 'windows', 'toast.ps1');

// 7s: the host hook budget is 10s total (hooks.json), shared with stdin read
// and the other channels — the toast subprocess must never be the thing that
// blows that budget.
const TOAST_TIMEOUT_MS = 7000;

export async function sendToast(notification) {
  if (platform !== 'win32') return false;
  return new Promise((resolve) => {
    const args = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TOAST_SCRIPT,
      '-Title', notification.title,
      '-Message', notification.message,
      '-Sound', notification.toastSound || 'Default',
      '-ClickToFocus', notification.clickToFocus === false ? 'false' : 'true',
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

    execFile('pwsh', args, { timeout: TOAST_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) logHookError('toast:windows', err, { stderr: (stderr || '').slice(0, 400) });
      resolve(!err);
    });
  });
}
