param(
  [string]$Title = 'Agent Notify',
  [string]$Message = 'Needs your attention',
  [string]$Sound = 'Default',
  [string]$ProjectName = '',
  [string]$Cwd = ''
)
$logo = Join-Path $PSScriptRoot '..\..\assets\icon.png'
# Fallback if icon.png not at expected location
if (-not (Test-Path $logo)) {
  $agentDir = Join-Path $env:USERPROFILE '.ai-agent-notifier'
  $logo = Join-Path $agentDir 'icon.png'
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

if ($ProjectName) {
  $hwnd = Get-AncestorWindowHandle
  $launchUri = "agentfocus://$([uri]::EscapeDataString($ProjectName))/?hwnd=$hwnd"
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
