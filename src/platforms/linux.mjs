// src/platforms/linux.mjs
import { execFile } from 'node:child_process';
import { getConfigDir } from '../config-loader.mjs';
import path from 'node:path';
import fs from 'node:fs';

const URGENCY_MAP = {
  urgent: 'critical',
  high: 'normal',
  default: 'low',
  low: 'low',
};

export function sendToast(notification) {
  return new Promise((resolve) => {
    // Per-source icon: assets/icons/<source>.png, fallback to legacy icon.png
    const iconsDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'assets', 'icons');
    let iconPath = notification.source ? path.join(iconsDir, `${notification.source}.png`) : '';
    if (!iconPath || !fs.existsSync(iconPath)) {
      iconPath = path.join(getConfigDir(), 'icon.png');
    }
    const args = [
      notification.title,
      notification.message,
      '--urgency', URGENCY_MAP[notification.ntfyPriority] || 'low',
    ];

    if (fs.existsSync(iconPath)) {
      args.push('--icon', iconPath);
    }

    execFile('notify-send', args, { timeout: 5000 }, (err) => {
      resolve(!err); // silent fail if notify-send not found
    });
  });
}
