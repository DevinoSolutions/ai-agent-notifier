param([string]$Arg)

$raw = $Arg -replace '^agentfocus:(//)?',''
$query = $null
if ($raw -match '\?(.+)$') {
  $query = $matches[1]
  $raw = $raw -replace '\?.+$',''
}
$target = [uri]::UnescapeDataString(($raw -replace '/$',''))

$requestedHwnd = [IntPtr]::Zero
if ($query) {
  foreach ($pair in ($query -split '&')) {
    $kv = $pair -split '=', 2
    if ($kv.Count -eq 2 -and $kv[0] -eq 'hwnd') {
      $parsed = [int64]0
      if ([int64]::TryParse($kv[1], [ref]$parsed) -and $parsed -ne 0) {
        $requestedHwnd = [IntPtr]::new($parsed)
      }
    }
  }
}

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinUtil {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
    public static List<KeyValuePair<IntPtr,string>> EnumerateTopLevelWindows() {
        var list = new List<KeyValuePair<IntPtr,string>>();
        EnumWindows((h, l) => {
            if (!IsWindowVisible(h)) return true;
            int len = GetWindowTextLength(h);
            if (len == 0) return true;
            var sb = new StringBuilder(len + 1);
            GetWindowText(h, sb, sb.Capacity);
            list.Add(new KeyValuePair<IntPtr,string>(h, sb.ToString()));
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
"@

function Focus-Window($h) {
  if ([WinUtil]::IsIconic($h)) { [WinUtil]::ShowWindow($h, 9) | Out-Null }
  [WinUtil]::BringWindowToTop($h) | Out-Null
  [WinUtil]::SwitchToThisWindow($h, $true)
  [WinUtil]::SetForegroundWindow($h) | Out-Null
}

if ($requestedHwnd -ne [IntPtr]::Zero -and [WinUtil]::IsWindow($requestedHwnd)) {
  Focus-Window $requestedHwnd
  return
}

if (-not $target) { return }
$targetLower = $target.ToLower()
$all = [WinUtil]::EnumerateTopLevelWindows()
$candidates = $all | Where-Object { $_.Value.ToLower().Contains($targetLower) }

$terminalPatterns = @('Windows Terminal','WindowsTerminal','pwsh','PowerShell','Warp','WezTerm','Alacritty','Hyper','ConEmu','cmd.exe','Command Prompt','tmux')

$hit = $candidates | Where-Object {
  $t = $_.Value
  foreach ($pat in $terminalPatterns) { if ($t -match [regex]::Escape($pat)) { return $true } }
  return $false
} | Select-Object -First 1

if (-not $hit) { $hit = $candidates | Where-Object { $_.Value -match 'Visual Studio Code$' } | Select-Object -First 1 }
if (-not $hit) { $hit = $candidates | Where-Object { $_.Value -match 'Cursor' } | Select-Object -First 1 }
if (-not $hit) { $hit = $candidates | Select-Object -First 1 }

if ($hit) { Focus-Window $hit.Key }
