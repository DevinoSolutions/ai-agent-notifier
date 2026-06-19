# assets/windows/bell.ps1 — Write BEL to the parent terminal's console.
# Claude Code hooks run with CREATE_NO_WINDOW, so this process has no console.
# We FreeConsole, AttachConsole to an ancestor, then write BEL to CONOUT$.
param()

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class Kernel32 {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool FreeConsole();

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool AttachConsole(int dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateFileW(
        string lpFileName, uint dwDesiredAccess, uint dwShareMode,
        IntPtr lpSecurityAttributes, uint dwCreationDisposition,
        uint dwFlagsAndAttributes, IntPtr hTemplateFile);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool WriteConsoleW(
        IntPtr hConsoleOutput, string lpBuffer, uint nNumberOfCharsToWrite,
        out uint lpNumberOfCharsWritten, IntPtr lpReserved);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);
}
'@ -ErrorAction Stop

function Write-Bel {
    # GENERIC_READ | GENERIC_WRITE = 0xC0000000, FILE_SHARE_WRITE = 2, OPEN_EXISTING = 3
    $handle = [Kernel32]::CreateFileW("CONOUT$", 0xC0000000, 2, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)
    if ($handle -eq [IntPtr]::new(-1)) { return $false }
    $written = 0
    $ok = [Kernel32]::WriteConsoleW($handle, "`a", 1, [ref]$written, [IntPtr]::Zero)
    [Kernel32]::CloseHandle($handle) | Out-Null
    return $ok
}

# Detach from the invisible console
[Kernel32]::FreeConsole() | Out-Null

# Strategy 1: attach to parent (-1 = ATTACH_PARENT_PROCESS)
if ([Kernel32]::AttachConsole(-1)) {
    if (Write-Bel) { exit 0 }
    [Kernel32]::FreeConsole() | Out-Null
}

# Strategy 2: walk the process tree to find an ancestor with a console
try {
    $pid = $PID
    for ($i = 0; $i -lt 20; $i++) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $pid" -ErrorAction Stop
        if (-not $proc -or -not $proc.ParentProcessId) { break }
        $pid = $proc.ParentProcessId
        if ($pid -le 4) { break }
        if ([Kernel32]::AttachConsole($pid)) {
            if (Write-Bel) { exit 0 }
            [Kernel32]::FreeConsole() | Out-Null
        }
    }
} catch {}

exit 1
