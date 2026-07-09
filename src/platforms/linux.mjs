// src/platforms/linux.mjs
import { execFile } from 'node:child_process';
import { getConfigDir } from '../config-loader.mjs';
import { logHookError } from '../error-log.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// notification.priority uses the app-wide ntfy scale; notify-send only knows
// low|normal|critical.
export const URGENCY_MAP = {
  urgent: 'critical',
  high: 'normal',
  default: 'low',
  low: 'low',
  min: 'low',
};

export function sendToast(notification) {
  return new Promise((resolve) => {
    // Per-source icon: assets/icons/<source>.png, fallback to legacy icon.png
    const iconsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'icons');
    let iconPath = notification.source ? path.join(iconsDir, `${notification.source}.png`) : '';
    if (!iconPath || !fs.existsSync(iconPath)) {
      iconPath = path.join(getConfigDir(), 'icon.png');
    }
    const args = [
      notification.title,
      notification.message,
      '--urgency', URGENCY_MAP[notification.priority] || 'low',
    ];

    if (fs.existsSync(iconPath)) {
      args.push('--icon', iconPath);
    }

    execFile('notify-send', args, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) logHookError('toast:linux', err, { stderr: (stderr || '').slice(0, 400) });
      resolve(!err);
    });
  });
}
