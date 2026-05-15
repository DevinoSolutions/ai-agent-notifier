// src/platforms/windows.mjs
import { execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOAST_SCRIPT = path.join(__dirname, '..', '..', 'assets', 'windows', 'toast.ps1');

// Resolve ancestor window handle from Node's process tree.
// Node runs inside Claude Code's terminal — walking up finds the right window
// even when multiple terminals are open. Cached so it's only computed once.
let _cachedHwnd = null;
function getAncestorHwnd() {
  if (_cachedHwnd !== null) return _cachedHwnd;
  try {
    const script = `
      $id = ${process.pid}
      for ($i = 0; $i -lt 10; $i++) {
        try {
          $p = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
          if (-not $p) { break }
          $id = [int]$p.ParentProcessId
          if ($id -le 0) { break }
          $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
          if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
            Write-Output ([int64]$proc.MainWindowHandle)
            return
          }
        } catch { break }
      }
      Write-Output 0
    `;
    const result = execFileSync('pwsh', ['-NoProfile', '-Command', script], { timeout: 5000 }).toString().trim();
    _cachedHwnd = result && result !== '0' ? result : '0';
  } catch {
    _cachedHwnd = '0';
  }
  return _cachedHwnd;
}

export async function sendToast(notification) {
  const hwnd = getAncestorHwnd();

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

    if (hwnd !== '0') {
      args.push('-Hwnd', hwnd);
    }

    execFile('pwsh', args, { timeout: 10000 }, (err) => {
      resolve(!err);
    });
  });
}
