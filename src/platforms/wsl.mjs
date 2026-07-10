// src/platforms/wsl.mjs — WSL-aware Windows-native toast backend.
// Under WSL the Linux notify-send stack is usually absent, but the Windows host
// is a single interop hop away, so we raise a real Windows toast by invoking
// PowerShell across the /mnt/c boundary. Detection and delivery are both
// best-effort: every probe is guarded and any failure resolves to "unavailable"
// rather than throwing into the hook path.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';

// --- Detection -------------------------------------------------------------

function readFileGuarded(readFile, file) {
  try { return String(readFile(file) || ''); } catch { return ''; }
}

function existsGuarded(existsSync, file) {
  try { return Boolean(existsSync(file)); } catch { return false; }
}

// deps are injectable so the truth table stays deterministic no matter what host
// runs it — including a real WSL shell, where process env and /proc would
// otherwise leak in and flip cases. Defaults are the real os/fs primitives.
export function isWsl(deps = {}) {
  const {
    platform = os.platform,
    release = os.release,
    readFile = (file) => fs.readFileSync(file, 'utf8'),
    existsSync = fs.existsSync,
    env = process.env,
  } = deps;

  // WSL is a Linux userland; nothing else can be it. Gate first so we never
  // touch /proc on Windows/macOS.
  let plat = '';
  try { plat = platform(); } catch { plat = ''; }
  if (plat !== 'linux') return false;

  // Docker Desktop runs its Linux engine on the same microsoft-tagged WSL2
  // kernel, so a container would otherwise look like WSL — bail on the container
  // markers before any positive signal.
  if (existsGuarded(existsSync, '/.dockerenv')) return false;
  if (existsGuarded(existsSync, '/run/.containerenv')) return false;

  // Primary signal (matches is-wsl): the microsoft tag in the kernel banner.
  let rel = '';
  try { rel = String(release() || ''); } catch { rel = ''; }
  if (rel.toLowerCase().includes('microsoft')) return true;
  if (readFileGuarded(readFile, '/proc/version').toLowerCase().includes('microsoft')) return true;

  // Custom kernels can drop the microsoft tag while WSL still exports its interop
  // env and marker files — treat those as authoritative fallbacks.
  if (env && (env.WSL_INTEROP || env.WSL_DISTRO_NAME)) return true;
  if (existsGuarded(existsSync, '/proc/sys/fs/binfmt_misc/WSLInterop')) return true;
  if (existsGuarded(existsSync, '/run/WSL')) return true;

  return false;
}

// --- Delivery --------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOAST_SCRIPT = path.join(__dirname, '..', '..', 'assets', 'windows', 'toast-wsl.ps1');

// 7s mirrors the native Windows backend: the host hook budget is 10s total and
// the toast subprocess must never be the thing that blows it (cold interop start
// is a documented 600ms–2.5s).
const TOAST_TIMEOUT_MS = 7000;

// Probed in order on the first send; the winner is cached module-level so steady
// state is a single spawn. Absolute /mnt/c paths first (no PATH lookup), then
// bare names for setups where appendWindowsPath keeps interop on PATH.
const EXE_CANDIDATES = [
  '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
  'powershell.exe',
  '/mnt/c/Program Files/PowerShell/7/pwsh.exe',
  'pwsh.exe',
];

let cachedExe = null;
let cachedWinPath = null;

function toWindowsPath(linuxPath) {
  return new Promise((resolve) => {
    try {
      execFile('wslpath', ['-w', linuxPath], { timeout: TOAST_TIMEOUT_MS }, (err, stdout) => {
        if (err) return resolve(null);
        const out = String(stdout || '').trim();
        resolve(out || null);
      });
    } catch {
      resolve(null);
    }
  });
}

function runToast(exe, winPath, title, message) {
  return new Promise((resolve) => {
    try {
      // -File + typed param() binding only — never -Command/-EncodedCommand,
      // which tripped an EDR false-positive against Codex when spawned from WSL.
      const args = [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-WindowStyle', 'Hidden', '-File', winPath,
        '-Title', title, '-Message', message,
      ];
      execFile(exe, args, { timeout: TOAST_TIMEOUT_MS }, (err) => resolve(!err));
    } catch {
      resolve(false);
    }
  });
}

export async function sendToast(notification) {
  const title = String(notification?.title ?? '');
  const message = String(notification?.message ?? '');

  // The script path is constant; translate once to its \\wsl.localhost\... UNC.
  if (!cachedWinPath) cachedWinPath = await toWindowsPath(TOAST_SCRIPT);
  if (!cachedWinPath) return false;

  if (cachedExe) return runToast(cachedExe, cachedWinPath, title, message);

  // First send: walk the probe chain and cache the first exe that fires. A
  // missing exe or disabled interop just errors (ENOENT/timeout) — we move on and
  // ultimately resolve false without trying to diagnose.
  for (const exe of EXE_CANDIDATES) {
    if (await runToast(exe, cachedWinPath, title, message)) {
      cachedExe = exe;
      return true;
    }
  }
  return false;
}
