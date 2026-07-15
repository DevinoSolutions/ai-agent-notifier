// src/platforms/macos.mjs
import { execFile } from 'node:child_process';
import { logHookError } from '../error-log.mjs';

// The 14 built-in macOS system sounds (files in /System/Library/Sounds).
const MAC_SYSTEM_SOUNDS = new Set([
  'Basso', 'Blow', 'Bottle', 'Frog', 'Funk', 'Glass', 'Hero',
  'Morse', 'Ping', 'Pop', 'Purr', 'Sosumi', 'Submarine', 'Tink',
]);

// Default config ships Windows SoundEvent names (IM, Reminder, …). Forwarding
// them to `sound name "IM"` produces an invalid NSSound name that macOS ignores
// (and logs). Map the shipped names to real macOS sounds; omit the clause for
// Default/unknown so the system default sound plays.
const WINDOWS_TO_MAC_SOUND = { IM: 'Glass', Reminder: 'Ping', Mail: 'Purr', SMS: 'Tink' };

export function macSoundName(toastSound) {
  if (!toastSound || toastSound === 'Default') return null;
  if (MAC_SYSTEM_SOUNDS.has(toastSound)) return toastSound;
  if (WINDOWS_TO_MAC_SOUND[toastSound]) return WINDOWS_TO_MAC_SOUND[toastSound];
  if (/^(Alarm|Call)\d*$/.test(toastSound)) return 'Sosumi';
  return null;
}

export function sendToast(notification) {
  return new Promise((resolve) => {
    const sound = macSoundName(notification.toastSound);
    const soundClause = sound ? ` sound name "${esc(sound)}"` : '';
    const script = `display notification "${esc(notification.message)}" with title "${esc(notification.title)}"${soundClause}`;

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
