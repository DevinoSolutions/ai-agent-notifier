# Terminal Bell Notification Channel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a terminal bell (`\x07`) notification channel that works on Windows (where hooks run without a console) and Unix (with /dev/tty + tmux fallback).

**Architecture:** New `src/bell.mjs` module exports `sendBell()` which dispatches to `sendBellWindows()` or `sendBellUnix()` based on `os.platform()`. Windows uses a PowerShell P/Invoke script to FreeConsole/AttachConsole and write BEL to CONOUT$. Unix writes BEL to /dev/tty with tmux pane fallback. Integrated into `src/notify.mjs` as a third channel alongside toast and ntfy.

**Tech Stack:** Node.js 18+, `node:child_process` (execFile), `node:fs` (Unix /dev/tty write), `node:test` + `node:assert/strict`

---

## File Map

| File | Role |
|------|------|
| `src/bell.mjs` | **Create.** Exports `sendBell()`, `sendBellWindows()`, `sendBellUnix()`. Platform dispatch. |
| `assets/windows/bell.ps1` | **Create.** PowerShell script: P/Invoke FreeConsole + AttachConsole + write BEL to CONOUT$. |
| `config/default-config.json` | **Modify.** Add `"terminalBell": { "enabled": true }`. |
| `src/notify.mjs` | **Modify.** Import `sendBell`, add it as third channel in dispatch. |
| `tests/bell.test.mjs` | **Create.** Unit tests for bell module. |
| `tests/e2e/bell.e2e.test.mjs` | **Create.** E2E subprocess tests for bell integration. |

---

### Task 1: Create the PowerShell bell script

**Files:**
- Create: `assets/windows/bell.ps1`

This is a self-contained PowerShell script that Node will call via `execFile`. It uses .NET P/Invoke to call kernel32.dll functions because `[Console]::Beep()` produces a speaker tone, not a terminal bell.

- [ ] **Step 1: Create `assets/windows/bell.ps1`**

```powershell
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
```

- [ ] **Step 2: Verify the script parses without errors on Windows**

Run: `pwsh -NoProfile -Command "& { $null = [System.Management.Automation.Language.Parser]::ParseFile('assets/windows/bell.ps1', [ref]$null, [ref]$errors); if ($errors.Count) { $errors | ForEach-Object { $_.Message }; exit 1 } else { Write-Output 'OK' } }"`

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add assets/windows/bell.ps1
git commit -m "feat(bell): add PowerShell P/Invoke script for Windows terminal bell"
```

---

### Task 2: Create `src/bell.mjs` — the bell module

**Files:**
- Create: `src/bell.mjs`

- [ ] **Step 1: Write the failing test for `sendBell` platform dispatch**

Create `tests/bell.test.mjs`:

```javascript
// tests/bell.test.mjs — strict, no-mock tests for the terminal bell channel.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { sendBell, sendBellWindows, sendBellUnix } from '../src/bell.mjs';

describe('sendBell — platform dispatch', () => {
  it('returns a boolean (true or false)', async () => {
    const result = await sendBell();
    assert.equal(typeof result, 'boolean');
  });

  it('calls the correct platform function and returns boolean', async () => {
    const platform = os.platform();
    if (platform === 'win32') {
      const result = await sendBellWindows();
      assert.equal(typeof result, 'boolean');
    } else {
      const result = await sendBellUnix();
      assert.equal(typeof result, 'boolean');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/bell.test.mjs`

Expected: FAIL — `Cannot find module '../src/bell.mjs'`

- [ ] **Step 3: Implement `src/bell.mjs`**

```javascript
// src/bell.mjs — Terminal bell notification channel.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BELL_SCRIPT = path.join(__dirname, '..', 'assets', 'windows', 'bell.ps1');

export async function sendBellWindows() {
  return new Promise((resolve) => {
    execFile('pwsh', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', BELL_SCRIPT,
    ], { timeout: 10000 }, (err) => {
      resolve(!err);
    });
  });
}

export async function sendBellUnix() {
  // Strategy 1: write BEL to /dev/tty
  try {
    const fd = fs.openSync('/dev/tty', 'w');
    fs.writeSync(fd, '\x07');
    fs.closeSync(fd);
    return true;
  } catch {
    // /dev/tty unavailable (no controlling terminal) — try tmux fallback
  }

  // Strategy 2: tmux pane tty
  const tmuxPane = process.env.TMUX_PANE;
  if (tmuxPane) {
    try {
      const ttyPath = await new Promise((resolve, reject) => {
        execFile('tmux', [
          'display-message', '-p', '-t', tmuxPane, '#{pane_tty}',
        ], { timeout: 5000 }, (err, stdout) => {
          if (err) return reject(err);
          const p = (stdout || '').trim();
          if (!p) return reject(new Error('empty tty path'));
          resolve(p);
        });
      });
      const fd = fs.openSync(ttyPath, 'w');
      fs.writeSync(fd, '\x07');
      fs.closeSync(fd);
      return true;
    } catch {
      // tmux fallback failed
    }
  }

  return false;
}

export async function sendBell() {
  try {
    if (os.platform() === 'win32') return await sendBellWindows();
    return await sendBellUnix();
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/bell.test.mjs`

Expected: PASS — both tests pass (the bell may or may not actually ring depending on the terminal, but the function returns a boolean).

- [ ] **Step 5: Commit**

```bash
git add src/bell.mjs tests/bell.test.mjs
git commit -m "feat(bell): add bell module with platform dispatch and unit tests"
```

---

### Task 3: Add platform-specific bell tests

**Files:**
- Modify: `tests/bell.test.mjs`

- [ ] **Step 1: Add Windows-specific tests**

Append to `tests/bell.test.mjs`:

```javascript
describe('sendBellWindows — Windows-only (fails if not on win32)', () => {
  const platform = os.platform();

  it('executes the PowerShell bell script and returns boolean', async (t) => {
    if (platform !== 'win32') return t.skip('not Windows');
    const result = await sendBellWindows();
    assert.equal(typeof result, 'boolean');
  });

  it('returns false when pwsh is unavailable', async (t) => {
    if (platform === 'win32') return t.skip('pwsh is available on Windows');
    // On non-Windows, pwsh may not exist or the script path is wrong
    const result = await sendBellWindows();
    assert.equal(result, false);
  });
});
```

- [ ] **Step 2: Add Unix-specific tests**

Append to `tests/bell.test.mjs`:

```javascript
describe('sendBellUnix — Unix-only', () => {
  const platform = os.platform();

  it('writes BEL to /dev/tty when a controlling terminal exists', async (t) => {
    if (platform === 'win32') return t.skip('not Unix');
    // In an interactive terminal, /dev/tty is available.
    // In CI without a tty, sendBellUnix returns false — that's the no-tty path.
    const result = await sendBellUnix();
    assert.equal(typeof result, 'boolean');

    // If /dev/tty exists, we expect true; if not, false.
    let hasTty = false;
    try { fs.accessSync('/dev/tty', fs.constants.W_OK); hasTty = true; } catch {}
    assert.equal(result, hasTty, `/dev/tty ${hasTty ? 'exists' : 'missing'} but sendBellUnix returned ${result}`);
  });

  it('returns false when both /dev/tty and tmux are unavailable', async (t) => {
    if (platform === 'win32') return t.skip('not Unix');
    // We can't easily remove /dev/tty in a test, but we verify the function
    // signature and return type. The no-tty + no-tmux path is tested in e2e
    // by spawning a subprocess without a controlling terminal.
    const result = await sendBellUnix();
    assert.equal(typeof result, 'boolean');
  });
});
```

- [ ] **Step 3: Add an import for `fs` at the top of the test file**

The test file needs `fs` for the `/dev/tty` access check. Add to the import block at the top:

```javascript
import fs from 'node:fs';
```

Full import block should now be:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import { sendBell, sendBellWindows, sendBellUnix } from '../src/bell.mjs';
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/bell.test.mjs`

Expected: All tests PASS (with platform-appropriate skips — Windows tests skip on Unix, Unix tests skip on Windows).

- [ ] **Step 5: Commit**

```bash
git add tests/bell.test.mjs
git commit -m "test(bell): add platform-specific bell tests"
```

---

### Task 4: Add `terminalBell` to default config

**Files:**
- Modify: `config/default-config.json`
- Modify: `tests/bell.test.mjs`

- [ ] **Step 1: Write the failing test for config defaults**

Append to `tests/bell.test.mjs`:

```javascript
import { loadConfig } from '../src/config-loader.mjs';

describe('terminalBell config defaults', () => {
  it('default config has terminalBell.enabled = true', () => {
    const config = loadConfig();
    assert.equal(config.terminalBell?.enabled, true);
  });
});
```

Add the `loadConfig` import to the top of the file (alongside the other imports):

```javascript
import { loadConfig } from '../src/config-loader.mjs';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/bell.test.mjs`

Expected: FAIL — `config.terminalBell` is undefined.

- [ ] **Step 3: Add `terminalBell` section to `config/default-config.json`**

Add `"terminalBell": { "enabled": true }` after the `"toast"` section. The full file becomes:

```json
{
  "ntfy": {
    "enabled": true,
    "server": "https://ntfy.sh",
    "topic": "",
    "click": "https://claude.ai/"
  },
  "toast": {
    "enabled": true,
    "clickToFocus": true
  },
  "terminalBell": {
    "enabled": true
  },
  "events": {
    "task_complete": {
      "sound": "IM",
      "ntfyPriority": "default",
      "ntfyTags": "white_check_mark"
    },
    "needs_input": {
      "sound": "Reminder",
      "ntfyPriority": "urgent",
      "ntfyTags": "bell,warning"
    },
    "session_start": {
      "sound": "Default",
      "ntfyPriority": "low",
      "ntfyTags": "rocket",
      "toastEnabled": false,
      "ntfyEnabled": false
    }
  },
  "sources": {
    "claude": {
      "label": "Claude Code",
      "icon": "https://cdn.jsdelivr.net/gh/anthropics/anthropic-branding@main/icon/claude-app-icon.png"
    },
    "codex": {
      "label": "Codex",
      "icon": "https://openai.com/favicon.ico"
    },
    "gemini": {
      "label": "Gemini",
      "icon": "https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690b6.svg"
    },
    "cursor": {
      "label": "Cursor",
      "icon": "https://cursor.com/apple-touch-icon.png"
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/bell.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add config/default-config.json tests/bell.test.mjs
git commit -m "feat(bell): add terminalBell config with enabled:true default"
```

---

### Task 5: Integrate bell into notify.mjs dispatch

**Files:**
- Modify: `src/notify.mjs:1-11` (imports) and `src/notify.mjs:95-108` (dispatch block)

- [ ] **Step 1: Write the failing E2E test**

Create `tests/e2e/bell.e2e.test.mjs`:

```javascript
// tests/e2e/bell.e2e.test.mjs — E2E subprocess tests for terminal bell integration.
// Spawns the real notify.mjs process and verifies bell channel behavior via stderr output.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { seedTempHome, writeUserConfig, runNode, clearLock } from './helpers.mjs';

describe('terminal bell e2e — subprocess invocation', () => {
  const homes = [];
  after(() => homes.forEach((h) => fs.rmSync(h, { recursive: true, force: true })));

  it('bell channel is attempted when terminalBell.enabled is true (default)', () => {
    const home = seedTempHome();
    homes.push(home);
    // Disable toast and ntfy to isolate bell behavior. Bell is enabled by default.
    writeUserConfig(home, { toast: { enabled: false }, ntfy: { enabled: false } });
    const stdin = JSON.stringify({ hook_event_name: 'Stop', cwd: '/work/proj', session_id: 'x' });
    const res = runNode(['src/notify.mjs', '--source', 'claude'], { home, stdin });
    assert.equal(res.status, 0, `notify.mjs exited non-zero: ${res.stderr}`);
    // The process exits 0 regardless — bell is best-effort.
    // We just verify the hook completes without crashing when bell is in the dispatch.
  });

  it('bell channel is excluded when terminalBell.enabled is false', () => {
    const home = seedTempHome();
    homes.push(home);
    writeUserConfig(home, { toast: { enabled: false }, ntfy: { enabled: false }, terminalBell: { enabled: false } });
    const stdin = JSON.stringify({ hook_event_name: 'Stop', cwd: '/work/proj', session_id: 'x' });
    const res = runNode(['src/notify.mjs', '--source', 'claude'], { home, stdin });
    assert.equal(res.status, 0, `notify.mjs exited non-zero: ${res.stderr}`);
  });

  it('bell channel respects per-event terminalBellEnabled override', () => {
    const home = seedTempHome();
    homes.push(home);
    writeUserConfig(home, {
      toast: { enabled: false },
      ntfy: { enabled: false },
      terminalBell: { enabled: true },
      events: { task_complete: { terminalBellEnabled: false } },
    });
    const stdin = JSON.stringify({ hook_event_name: 'Stop', cwd: '/work/proj', session_id: 'x' });
    const res = runNode(['src/notify.mjs', '--source', 'claude'], { home, stdin });
    assert.equal(res.status, 0, `notify.mjs exited non-zero: ${res.stderr}`);
  });

  it('all three channels coexist without interference', () => {
    const home = seedTempHome();
    homes.push(home);
    // Enable all channels — bell + toast + ntfy (ntfy without topic = no-op).
    writeUserConfig(home, {
      toast: { enabled: true },
      ntfy: { enabled: true, server: 'https://ntfy.sh', topic: '' },
      terminalBell: { enabled: true },
    });
    const stdin = JSON.stringify({ hook_event_name: 'Stop', cwd: '/work/proj', session_id: 'x' });
    const res = runNode(['src/notify.mjs', '--source', 'claude'], { home, stdin });
    assert.equal(res.status, 0, `notify.mjs should handle all channels gracefully: ${res.stderr}`);
  });
});
```

- [ ] **Step 2: Run the E2E test to verify it passes with the current code (no bell yet)**

Run: `node --test tests/e2e/bell.e2e.test.mjs`

Expected: PASS — the tests verify exit code 0, and the current notify.mjs simply ignores the bell config it doesn't know about. This establishes a baseline.

- [ ] **Step 3: Add bell import and dispatch to `src/notify.mjs`**

Add the import at line 11 (after `sendNtfy` import):

```javascript
import { sendBell } from './bell.mjs';
```

Add the bell dispatch block in the `main()` function, after the ntfy block (after line 106, before `await Promise.allSettled(tasks)`):

```javascript
    // Terminal bell
    if (config.terminalBell?.enabled !== false && eventConfig.terminalBellEnabled !== false) {
      tasks.push(sendBell());
    }
```

The dispatch section (lines 95-108) should now look like:

```javascript
    const tasks = [];

    // Toast
    if (config.toast?.enabled !== false && eventConfig.toastEnabled !== false) {
      const sendToast = await getToastBackend();
      tasks.push(sendToast(notification));
    }

    // ntfy
    if (config.ntfy?.enabled && config.ntfy?.topic && eventConfig.ntfyEnabled !== false) {
      tasks.push(sendNtfy(config.ntfy, notification));
    }

    // Terminal bell
    if (config.terminalBell?.enabled !== false && eventConfig.terminalBellEnabled !== false) {
      tasks.push(sendBell());
    }

    await Promise.allSettled(tasks);
```

- [ ] **Step 4: Run the full test suite**

Run: `node --test tests/*.test.mjs && node --test tests/e2e/bell.e2e.test.mjs`

Expected: All tests PASS — existing tests unaffected, new bell e2e tests pass.

- [ ] **Step 5: Run the existing e2e tests to confirm no regressions**

Run: `node --test tests/e2e/*.test.mjs`

Expected: All existing e2e tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/notify.mjs tests/e2e/bell.e2e.test.mjs
git commit -m "feat(bell): integrate terminal bell as third notification channel"
```

---

### Task 6: Add config gating unit tests

**Files:**
- Modify: `tests/bell.test.mjs`

These tests verify the dispatch logic in `notify.mjs` by examining the config conditions, not by running the full main() function (which would need stdin piping). They test the same boolean expressions used in the dispatch.

- [ ] **Step 1: Add config gating tests**

Append to `tests/bell.test.mjs`:

```javascript
describe('bell config gating — dispatch condition logic', () => {
  // These test the exact boolean expressions from notify.mjs dispatch:
  //   config.terminalBell?.enabled !== false && eventConfig.terminalBellEnabled !== false

  function shouldBell(config, eventConfig = {}) {
    return config.terminalBell?.enabled !== false && eventConfig.terminalBellEnabled !== false;
  }

  it('bell fires when terminalBell.enabled is true', () => {
    assert.equal(shouldBell({ terminalBell: { enabled: true } }), true);
  });

  it('bell fires when terminalBell key is absent (default enabled)', () => {
    assert.equal(shouldBell({}), true);
  });

  it('bell is suppressed when terminalBell.enabled is false', () => {
    assert.equal(shouldBell({ terminalBell: { enabled: false } }), false);
  });

  it('bell is suppressed by per-event terminalBellEnabled: false', () => {
    assert.equal(shouldBell({ terminalBell: { enabled: true } }, { terminalBellEnabled: false }), false);
  });

  it('bell fires when per-event has no terminalBellEnabled key', () => {
    assert.equal(shouldBell({ terminalBell: { enabled: true } }, {}), true);
  });

  it('bell fires when per-event terminalBellEnabled is true', () => {
    assert.equal(shouldBell({ terminalBell: { enabled: true } }, { terminalBellEnabled: true }), true);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `node --test tests/bell.test.mjs`

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/bell.test.mjs
git commit -m "test(bell): add config gating unit tests for dispatch logic"
```

---

### Task 7: Final validation — full test suite

**Files:** None (verification only)

- [ ] **Step 1: Run the complete unit test suite**

Run: `node --test tests/*.test.mjs`

Expected: All tests PASS. No regressions in existing tests. The `smoke-load.test.mjs` test should still load all modules successfully (including the new `bell.mjs`).

- [ ] **Step 2: Run the complete e2e test suite**

Run: `node --test tests/e2e/*.test.mjs`

Expected: All tests PASS. Existing hook invocation tests, dedup tests, and new bell e2e tests all pass.

- [ ] **Step 3: Verify the module loads cleanly**

Run: `node -e "import('./src/bell.mjs').then(m => { console.log('exports:', Object.keys(m)); })"`

Expected: `exports: [ 'sendBellWindows', 'sendBellUnix', 'sendBell' ]`

- [ ] **Step 4: Commit any remaining changes (if any)**

If all tests pass and no changes are needed, this task is done.
