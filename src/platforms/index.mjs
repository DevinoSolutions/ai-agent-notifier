// src/platforms/index.mjs — Single owner of platform → toast-backend selection.
// Imported by the hook path (notify.mjs), the CLI test command, and the demo
// script so all three always dispatch identically.
import os from 'node:os';

export async function resolveToastBackend(platform = os.platform()) {
  if (platform === 'win32') return (await import('./windows.mjs')).sendToast;
  if (platform === 'darwin') return (await import('./macos.mjs')).sendToast;
  return (await import('./linux.mjs')).sendToast;
}
