// src/platforms/windows.mjs
import { execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOAST_SCRIPT = path.join(__dirname, '..', '..', 'assets', 'windows', 'toast.ps1');

// Resolve ancestor window handle from Node's process tree.
// Cached after first call. Non-critical — CWD-based title matching is the
// primary focus mechanism, hwnd is a fallback for edge cases.
let _cachedHwnd = null;
function getAncestorHwnd() {
  if (_cachedHwnd !== null) return _cachedHwnd;
  try {
    const script = `$id = ${process.pid}; for ($i = 0; $i -lt 10; $i++) { try { $p = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue; if (-not $p) { break }; $id = [int]$p.ParentProcessId; if ($id -le 0) { break }; $proc = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) { Write-Output ([int64]$proc.MainWindowHandle); return } } catch { break } }; Write-Output 0`;
    const result = execFileSync('pwsh', ['-NoProfile', '-Command', script], { timeout: 3000 }).toString().trim();
    _cachedHwnd = result && result !== '0' ? result : '0';
  } catch {
    _cachedHwnd = '0';
  }
  return _cachedHwnd;
}

// Start hwnd lookup in background immediately on module load
// so it's ready by the time sendToast is called
const _hwndPromise = new Promise((resolve) => {
  try {
    const result = getAncestorHwnd();
    resolve(result);
  } catch {
    resolve('0');
  }
});

export async function sendToast(notification) {
  // Use cached hwnd if available, don't wait more than 1s for it
  let hwnd = _cachedHwnd || '0';
  if (hwnd === '0') {
    hwnd = await Promise.race([
      _hwndPromise,
      new Promise(r => setTimeout(() => r('0'), 1000)),
    ]);
  }

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

    if (hwnd !== '0') {
      args.push('-Hwnd', hwnd);
    }

    execFile('pwsh', args, { timeout: 15000 }, (err) => {
      resolve(!err);
    });
  });
}
