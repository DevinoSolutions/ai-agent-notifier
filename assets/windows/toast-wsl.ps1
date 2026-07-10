param(
  [string]$Title = 'Agent Notify',
  [string]$Message = 'Needs your attention'
)
# Self-contained Windows-native toast for WSL callers. Raw WinRT only — no
# BurntToast or any external module — so Windows PowerShell 5.1 (always present on
# the Windows host) can run it straight off the \\wsl.localhost UNC path. Any
# failure is a terminating error so the caller (src/platforms/wsl.mjs) sees a
# non-zero exit and records the toast as unavailable.
$ErrorActionPreference = 'Stop'

# WinRT projections load natively in PS 5.1; the XmlDocument returned by
# GetTemplateContent is a live object, so only the notification types need hints.
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]

# PowerShell's pre-registered Start-Menu AppUserModelID. An unpackaged process
# needs a registered AppId to raise a toast; piggybacking PowerShell's own avoids
# shipping a registration step of our own.
$AppId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'

$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $xml.GetElementsByTagName('text')
$null = $texts.Item(0).AppendChild($xml.CreateTextNode($Title))
$null = $texts.Item(1).AppendChild($xml.CreateTextNode($Message))

$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($AppId).Show($toast)
