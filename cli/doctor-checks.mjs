// cli/doctor-checks.mjs — pure diagnostic logic for `aan doctor`. No console I/O;
// returns an array of { id, channel, status, detail, hint }. Each check is
// best-effort and never throws; runChecks aggregates them.
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { notificationAuthState, verifyDelivery, ncDbPath } from '../src/platforms/macos-delivery.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Terminals known to swallow OSC/BEL sequences (from the demand evidence).
const OSC_SWALLOWERS = { vscode: 'VS Code', windsurf: 'Windsurf' };

export const CHECK_IDS = {
  darwin: ['toast-backend', 'toast-auth', 'bell', 'ntfy-config', 'webhook-config', 'config', 'focus'],
  win32: ['toast-backend', 'bell', 'ntfy-config', 'webhook-config', 'config'],
  linux: ['toast-backend', 'bell', 'ntfy-config', 'webhook-config', 'config'],
  default: ['toast-backend', 'bell', 'ntfy-config', 'webhook-config', 'config'],
};

function has(bin) {
  try { execFileSync(os.platform() === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function toastBackendCheck() {
  const p = os.platform();
  if (p === 'darwin') {
    return has('osascript')
      ? { id: 'toast-backend', channel: 'toast', status: 'ok', detail: 'osascript present' }
      : { id: 'toast-backend', channel: 'toast', status: 'fail', detail: 'osascript missing', hint: 'macOS should always ship osascript' };
  }
  if (p === 'linux') {
    return has('notify-send')
      ? { id: 'toast-backend', channel: 'toast', status: 'ok', detail: 'notify-send present' }
      : { id: 'toast-backend', channel: 'toast', status: 'warn', detail: 'notify-send missing', hint: 'install libnotify-bin' };
  }
  // win32 is handled by windowsToastBackendCheck (async, probes PowerShell).
  return { id: 'toast-backend', channel: 'toast', status: 'ok', detail: 'BurntToast checked at send time' };
}

// Real Windows backend probe: the product path is `pwsh -File toast.ps1` →
// `Import-Module BurntToast`, so the honest checks are (1) PowerShell is present,
// (2) the BurntToast module resolves, (3) no policy-scope execution policy blocks
// scripts. Note the product invokes toast.ps1 with `-ExecutionPolicy Bypass`, so
// only a MachinePolicy/UserPolicy of Restricted|AllSigned actually blocks it
// (those scopes override -Bypass); Process/CurrentUser/LocalMachine do not.
// Dependencies are injected so this is unit-testable on any OS.
const BLOCKING_POLICIES = new Set(['Restricted', 'AllSigned']);

export function windowsToastBackendCheck({ hasBin = has, psRun = defaultPsRun } = {}) {
  const shell = hasBin('pwsh') ? 'pwsh' : hasBin('powershell') ? 'powershell' : null;
  if (!shell) {
    return {
      id: 'toast-backend', channel: 'toast', status: 'fail',
      detail: 'PowerShell not found (pwsh/powershell) — Windows toasts cannot fire',
      hint: 'install PowerShell 7: https://aka.ms/powershell',
    };
  }

  let probe;
  try { probe = psRun(shell); }
  catch (err) {
    return {
      id: 'toast-backend', channel: 'toast', status: 'warn',
      detail: `${shell} present but backend probe failed: ${err.message}`,
      hint: 'run `ai-agent-notifier test toast` to see the real error',
    };
  }

  const blocked = [probe.machinePolicy, probe.userPolicy].filter((p) => BLOCKING_POLICIES.has(p));
  if (blocked.length) {
    return {
      id: 'toast-backend', channel: 'toast', status: 'fail',
      detail: `PowerShell execution policy (${blocked.join('/')}) blocks scripts even with -ExecutionPolicy Bypass`,
      hint: 'a MachinePolicy/UserPolicy set by Group Policy overrides -Bypass; contact your admin or set a non-restrictive policy',
    };
  }
  if (!probe.burntToast) {
    return {
      id: 'toast-backend', channel: 'toast', status: 'warn',
      detail: `${shell} present, BurntToast module not installed`,
      hint: 'Install-Module BurntToast -Scope CurrentUser  (or run: ai-agent-notifier setup)',
    };
  }
  return { id: 'toast-backend', channel: 'toast', status: 'ok', detail: `${shell} + BurntToast present` };
}

// Default probe: one PowerShell call returning BurntToast presence + the two
// policy scopes that can override -Bypass. Returns a plain object; throws on spawn
// failure (caught above and surfaced as a warn).
function defaultPsRun(shell) {
  const cmd =
    "$bt=[bool](Get-Module -ListAvailable -Name BurntToast);" +
    "$mp=(Get-ExecutionPolicy -Scope MachinePolicy).ToString();" +
    "$up=(Get-ExecutionPolicy -Scope UserPolicy).ToString();" +
    "[pscustomobject]@{burntToast=$bt;machinePolicy=$mp;userPolicy=$up}|ConvertTo-Json -Compress";
  const out = execFileSync(shell, ['-NoProfile', '-NonInteractive', '-Command', cmd], {
    encoding: 'utf8', timeout: 15000,
  });
  return JSON.parse(out.trim());
}

function bellCheck() {
  const term = (process.env.TERM_PROGRAM || '').toLowerCase();
  const swallow = Object.keys(OSC_SWALLOWERS).find((k) => term.includes(k));
  if (swallow) {
    return { id: 'bell', channel: 'bell', status: 'warn', detail: `TERM_PROGRAM=${process.env.TERM_PROGRAM}`, hint: `${OSC_SWALLOWERS[swallow]} may swallow the terminal bell` };
  }
  return { id: 'bell', channel: 'bell', status: 'ok', detail: `terminal ${process.env.TERM_PROGRAM || 'unknown'}` };
}

function ntfyCheck(config) {
  const ok = config?.ntfy?.enabled && config?.ntfy?.topic;
  return ok
    ? { id: 'ntfy-config', channel: 'ntfy', status: 'ok', detail: `${config.ntfy.server || 'https://ntfy.sh'}/${config.ntfy.topic}` }
    : { id: 'ntfy-config', channel: 'ntfy', status: 'warn', detail: 'ntfy not configured', hint: 'run: ai-agent-notifier setup' };
}

function webhookCheck(config) {
  if (!config?.webhook?.enabled) return { id: 'webhook-config', channel: 'webhook', status: 'ok', detail: 'webhook disabled' };
  try {
    const u = new URL(config.webhook.url);
    return { id: 'webhook-config', channel: 'webhook', status: 'ok', detail: u.origin };
  } catch {
    return { id: 'webhook-config', channel: 'webhook', status: 'fail', detail: 'webhook enabled but URL invalid', hint: 'run: ai-agent-notifier config webhook' };
  }
}

function configCheck(config, configProblem) {
  if (configProblem) return { id: 'config', channel: 'config', status: 'fail', detail: configProblem.message, hint: 'fix ~/.ai-agent-notifier/config.json' };
  if (!config || typeof config !== 'object') return { id: 'config', channel: 'config', status: 'fail', detail: 'config did not load' };
  return { id: 'config', channel: 'config', status: 'ok', detail: 'config valid' };
}

function focusCheck() {
  return { id: 'focus', channel: 'focus', status: ncDbPath() ? 'ok' : 'warn', detail: 'Focus/DND does not block delivery records (warn-only probe)' };
}

async function toastAuthCheck(deep, strict) {
  const auth = notificationAuthState();
  let status = auth.state === 'authorized' ? 'ok' : auth.state === 'unauthorized' ? 'warn' : 'warn';
  const base = { id: 'toast-auth', channel: 'toast', status, detail: auth.detail };
  if (!deep) return base;

  // --deep: fire a real marker toast through the production backend and verify.
  const { sendToast } = await import('../src/platforms/macos.mjs');
  const marker = `aan-doctor-${process.pid}-${Date.now().toString(36)}`;
  await sendToast({ title: 'ai-agent-notifier', message: `doctor check ${marker}`, toastSound: 'Default' });
  const res = await verifyDelivery(marker, { timeoutMs: 15000, pollMs: 1000 });
  if (res.delivered) return { id: 'toast-auth', channel: 'toast', status: 'ok', detail: `delivered + verified in Notification Center (${res.record.app || 'osascript'})` };
  if (res.reason === 'tcc-blocked') {
    return {
      id: 'toast-auth', channel: 'toast', status: strict ? 'fail' : 'warn',
      detail: 'cannot read Notification Center DB (Full Disk Access needed to verify)',
      hint: 'grant Full Disk Access to your terminal in System Settings → Privacy',
    };
  }
  return { id: 'toast-auth', channel: 'toast', status: strict ? 'fail' : 'warn', detail: `toast sent but no delivery record (${res.reason})`, hint: 'notifications may be disabled for this app in System Settings → Notifications' };
}

// Default dunstctl runner: returns { status, stdout } and does NOT throw on a
// non-zero exit (unlike execFileSync), so a missing/idle daemon degrades to a
// readable status instead of an exception. Injected in tests.
function defaultDunstctl(args) {
  const r = spawnSync('dunstctl', args, { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// Move any displayed notifications into history (dunst records a notification
// only once it closes), then scan the JSON history for `marker`. Polls a few
// times because the daemon commit is not synchronous with notify-send's exit.
async function dunstHistoryHasMarker(marker, { dunstctl, tries, pollMs, sleepFn }) {
  let sawHistory = false;
  for (let i = 0; i < tries; i++) {
    dunstctl(['close-all']);
    const res = dunstctl(['history']);
    if (res.status === 0) {
      sawHistory = true;
      let parsed;
      try { parsed = JSON.parse(res.stdout); } catch { parsed = null; }
      const items = parsed?.data?.[0] || [];
      for (const n of items) {
        const body = n?.body?.data || '';
        const summary = n?.summary?.data || '';
        if (body.includes(marker) || summary.includes(marker)) return { found: true };
      }
    }
    if (i < tries - 1) await sleepFn(pollMs);
  }
  return { found: false, sawHistory };
}

// Linux --deep probe: fire a REAL toast through the production backend
// (src/platforms/linux.mjs → notify-send, which keys urgency off
// notification.priority) with a nonce, then read it back from the dunst daemon's
// history to prove real delivery — the Linux analogue of the macOS NC read-back.
// When dunstctl is absent (GNOME/KDE/etc.) there is no history API to read, so we
// honestly report "dispatched but unverified" rather than assuming a pass. The
// fired toast is user-visible, hence the honest title and low urgency. Deps are
// injected so the whole probe is unit-testable off-Linux.
export async function linuxDeepToastCheck({
  hasBin = has,
  sendToast,
  dunstctl = defaultDunstctl,
  tries = 12,
  pollMs = 500,
  sleepFn = sleep,
} = {}) {
  const marker = `aan-doctor-${process.pid}-${Date.now().toString(36)}`;
  const notification = {
    source: 'claude',
    title: 'ai-agent-notifier doctor check',
    message: `test notification ${marker}`,
    priority: 'low', // visible to the user — keep it low-urgency
  };
  const delivered = await sendToast(notification);
  if (!delivered) {
    return {
      id: 'toast-deep', channel: 'toast', status: 'warn',
      detail: 'sent a test notification but notify-send did not exit 0',
      hint: 'install libnotify-bin and a running notification daemon',
    };
  }
  if (!hasBin('dunstctl')) {
    return {
      id: 'toast-deep', channel: 'toast', status: 'info',
      detail: 'sent a test notification via notify-send; this daemon exposes no history read-back (dunstctl not found), so delivery is dispatched-but-unverified',
      hint: 'delivery read-back is only available under the dunst daemon',
    };
  }
  const r = await dunstHistoryHasMarker(marker, { dunstctl, tries, pollMs, sleepFn });
  if (r.found) {
    return { id: 'toast-deep', channel: 'toast', status: 'ok', detail: 'sent a test notification and verified it in the dunst daemon history' };
  }
  if (!r.sawHistory) {
    return {
      id: 'toast-deep', channel: 'toast', status: 'warn',
      detail: 'dunstctl present but its history could not be read (daemon not running on this session bus?)',
      hint: 'start the dunst daemon, then re-run `ai-agent-notifier doctor --deep`',
    };
  }
  return {
    id: 'toast-deep', channel: 'toast', status: 'fail',
    detail: 'sent a test notification via notify-send but dunst never recorded it',
    hint: 'the notification daemon did not receive the payload',
  };
}

// Run all platform-appropriate checks. `strict` (AAN_DOCTOR_STRICT=1) turns
// deep-mode warns into fails so CI can gate on the product diagnostic.
export async function runChecks({ config, configProblem = null, deep = false, strict = false }) {
  const p = os.platform();
  const results = [];
  if (p === 'win32') {
    try { results.push(windowsToastBackendCheck()); }
    catch (err) { results.push({ id: 'toast-backend', channel: 'toast', status: 'warn', detail: `backend check errored: ${err.message}` }); }
  } else {
    results.push(toastBackendCheck());
  }
  if (p === 'darwin') {
    try { results.push(await toastAuthCheck(deep, strict)); }
    catch (err) { results.push({ id: 'toast-auth', channel: 'toast', status: 'warn', detail: `auth check errored: ${err.message}` }); }
  } else if (deep && p === 'linux') {
    // Linux has a real --deep probe: fire through notify-send and read the toast
    // back from the dunst daemon's history (TC-27). Falls back to an honest
    // "dispatched but unverified" line on non-dunst daemons.
    try {
      const { sendToast } = await import('../src/platforms/linux.mjs');
      results.push(await linuxDeepToastCheck({ sendToast }));
    } catch (err) {
      results.push({ id: 'toast-deep', channel: 'toast', status: 'warn', detail: `deep probe errored: ${err.message}` });
    }
  } else if (deep) {
    // win32 (and any other non-darwin, non-linux platform): no deep probe exists;
    // it would otherwise silently no-op, so say so explicitly.
    results.push({ id: 'deep-probe', channel: 'toast', status: 'info', detail: `deep verification not available on ${p} (static checks only)` });
  }
  results.push(bellCheck(), ntfyCheck(config), webhookCheck(config), configCheck(config, configProblem));
  if (p === 'darwin') results.push(focusCheck());
  return results;
}
