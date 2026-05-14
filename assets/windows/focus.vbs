' Zero-window launcher for focus-window.ps1
Set shell = CreateObject("WScript.Shell")
home = shell.ExpandEnvironmentStrings("%USERPROFILE%")
' Try npm global path first, then standalone path
Dim scriptPath
scriptPath = home & "\.ai-agent-notifier\assets\windows\focus-window.ps1"
If Not CreateObject("Scripting.FileSystemObject").FileExists(scriptPath) Then
  ' Resolve from same directory as this VBS
  scriptPath = Replace(WScript.ScriptFullName, WScript.ScriptName, "") & "focus-window.ps1"
End If
If WScript.Arguments.Count > 0 Then
  arg = WScript.Arguments(0)
  shell.Run "pwsh -NoProfile -ExecutionPolicy Bypass -File """ & scriptPath & """ """ & arg & """", 0, False
End If
