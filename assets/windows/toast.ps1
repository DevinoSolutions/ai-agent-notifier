param(
  [string]$Title = 'Agent Notify',
  [string]$Message = 'Needs your attention',
  [string]$Sound = 'Default',
  [string]$ProjectName = '',
  [string]$Cwd = '',
  [string]$Hwnd = '0',
  [string]$Source = '',
  [string]$ClickToFocus = 'true'
)
# Per-source icon: assets/icons/<source>.png
$iconsDir = Join-Path $PSScriptRoot '..\icons'
$logo = ''
if ($Source -and (Test-Path (Join-Path $iconsDir "$Source.png"))) {
  $logo = Join-Path $iconsDir "$Source.png"
} elseif (Test-Path (Join-Path $iconsDir 'claude.png')) {
  $logo = Join-Path $iconsDir 'claude.png'
}
# Fallback to legacy icon.png locations
if (-not $logo -or -not (Test-Path $logo)) {
  $legacy = Join-Path $PSScriptRoot '..\..\assets\icon.png'
  if (Test-Path $legacy) { $logo = $legacy }
  else {
    $agentDir = Join-Path $env:USERPROFILE '.ai-agent-notifier'
    $legacy2 = Join-Path $agentDir 'icon.png'
    if (Test-Path $legacy2) { $logo = $legacy2 }
  }
}
$launchUri = $null

function Register-AgentFocusProtocol {
  $regPath = 'HKCU:\Software\Classes\agentfocus'
  $handler = Join-Path $PSScriptRoot 'focus.vbs'
  $cmd = "wscript.exe `"$handler`" `"%1`""
  $existing = (Get-ItemProperty "$regPath\shell\open\command" -ErrorAction SilentlyContinue).'(default)'
  if ($existing -eq $cmd) { return }
  New-Item -Path $regPath -Force | Out-Null
  Set-ItemProperty -Path $regPath -Name '(default)' -Value 'URL:Agent Focus Protocol'
  Set-ItemProperty -Path $regPath -Name 'URL Protocol' -Value ''
  New-Item -Path "$regPath\shell\open\command" -Force | Out-Null
  Set-ItemProperty -Path "$regPath\shell\open\command" -Name '(default)' -Value $cmd
}
if ($ClickToFocus -ne 'false') { Register-AgentFocusProtocol }

function Get-AncestorWindowHandle {
  # Walk the parent-process chain to find the owning terminal/IDE window.
  # Built from a single Toolhelp32 snapshot rather than per-process
  # Get-CimInstance Win32_Process calls: on some machines WMI takes ~2-3s per
  # query, and 10 of them blows past the hook's pwsh timeout (toast never fires).
  try {
    if (-not ([System.Management.Automation.PSTypeName]'AANProcMap').Type) {
      Add-Type -ErrorAction Stop -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class AANProcMap {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
  public struct PROCESSENTRY32 {
    public uint dwSize; public uint cntUsage; public uint th32ProcessID;
    public IntPtr th32DefaultHeapID; public uint th32ModuleID; public uint cntThreads;
    public uint th32ParentProcessID; public int pcPriClassBase; public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
  }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll")] static extern bool Process32First(IntPtr h, ref PROCESSENTRY32 e);
  [DllImport("kernel32.dll")] static extern bool Process32Next(IntPtr h, ref PROCESSENTRY32 e);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static Dictionary<uint, uint> ParentMap() {
    var map = new Dictionary<uint, uint>();
    IntPtr snap = CreateToolhelp32Snapshot(2u, 0u); // TH32CS_SNAPPROCESS
    if (snap == IntPtr.Zero || snap == new IntPtr(-1)) { return map; }
    var e = new PROCESSENTRY32(); e.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
    if (Process32First(snap, ref e)) { do { map[e.th32ProcessID] = e.th32ParentProcessID; } while (Process32Next(snap, ref e)); }
    CloseHandle(snap); return map;
  }
}
'@
    }
    $map = [AANProcMap]::ParentMap()
    $id = [uint32]$PID
    for ($i = 0; $i -lt 20; $i++) {
      if (-not $map.ContainsKey($id)) { break }
      $parent = $map[$id]
      if ($parent -le 0) { break }
      $proc = Get-Process -Id $parent -ErrorAction SilentlyContinue
      if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
        return [int64]$proc.MainWindowHandle
      }
      $id = $parent
    }
  } catch {}
  return 0
}

if (($ProjectName -or $Cwd) -and $ClickToFocus -ne 'false') {
  if ($Hwnd -ne '0') {
    $hwnd = $Hwnd
  } else {
    $hwnd = Get-AncestorWindowHandle
  }
  $encodedName = if ($ProjectName) { [uri]::EscapeDataString($ProjectName) } else { '_' }
  $launchUri = "agentfocus://$encodedName/?hwnd=$hwnd"
  if ($Cwd) { $launchUri += "&cwd=$([uri]::EscapeDataString($Cwd))" }
}

try {
  Import-Module BurntToast -ErrorAction Stop

  if ($launchUri) {
    $audio   = New-BTAudio -Source "ms-winsoundevent:Notification.$Sound"
    $text1   = New-BTText -Text $Title
    $text2   = New-BTText -Text $Message
    $binding = if (Test-Path $logo) {
      $appLogo = New-BTImage -Source $logo -AppLogoOverride -Crop Circle
      New-BTBinding -Children $text1, $text2 -AppLogoOverride $appLogo
    } else {
      New-BTBinding -Children $text1, $text2
    }
    $visual  = New-BTVisual -BindingGeneric $binding
    $content = New-BTContent -Audio $audio -Visual $visual -Launch $launchUri -ActivationType Protocol
    Submit-BTNotification -Content $content
  } else {
    if (Test-Path $logo) {
      New-BurntToastNotification -Text $Title, $Message -Sound $Sound -AppLogo $logo
    } else {
      New-BurntToastNotification -Text $Title, $Message -Sound $Sound
    }
  }
} catch {
  # Degraded fallback: still make a sound, but exit non-zero so the caller
  # (src/platforms/windows.mjs) records WHY the real toast never appeared.
  try { [System.Media.SystemSounds]::Exclamation.Play() } catch {}
  [Console]::Error.WriteLine("toast.ps1: BurntToast notification failed: $($_.Exception.Message)")
  exit 3
}
