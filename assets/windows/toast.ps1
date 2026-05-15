param(
  [string]$Title = 'Agent Notify',
  [string]$Message = 'Needs your attention',
  [string]$Sound = 'Default',
  [string]$ProjectName = '',
  [string]$Cwd = '',
  [string]$Hwnd = '0',
  [string]$Source = ''
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
Register-AgentFocusProtocol

function Get-AncestorWindowHandle {
  $id = $PID
  for ($i = 0; $i -lt 10; $i++) {
    try {
      $p = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
      if (-not $p) { break }
      $id = [int]$p.ParentProcessId
      if ($id -le 0) { break }
      $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
      if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
        return [int64]$proc.MainWindowHandle
      }
    } catch { break }
  }
  return 0
}

if ($ProjectName -or $Cwd) {
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
  try { [System.Media.SystemSounds]::Exclamation.Play() } catch {}
}
