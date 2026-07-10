// src/platforms/index.mjs — Single owner of platform → toast-backend selection.
// Imported by the hook path (notify.mjs), the CLI test command, and the demo
// script so all three always dispatch identically.
import os from 'node:os';
import { isWsl as realIsWsl } from './wsl.mjs';

export async function resolveToastBackend(platform = os.platform(), { isWsl = realIsWsl } = {}) {
  if (platform === 'win32') return (await import('./windows.mjs')).sendToast;
  if (platform === 'darwin') return (await import('./macos.mjs')).sendToast;
  // WSL is a Linux userland but reaches the user through a Windows-native toast;
  // fall back to notify-send only on real Linux. isWsl is injected so the
  // resolver stays deterministic even when the suite itself runs inside WSL.
  if (platform === 'linux' && isWsl()) return (await import('./wsl.mjs')).sendToast;
  return (await import('./linux.mjs')).sendToast;
}
