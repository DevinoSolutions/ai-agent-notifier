# Terminal Bell Notification Channel

**Date:** 2026-06-19
**Status:** Approved

## Overview

Add a terminal bell notification channel to ai-agent-notifier. When a notification fires, the BEL character (`\x07`) is written to the terminal that started the Claude session, causing the terminal to highlight the tab (Windows Terminal, Ghostty, iTerm2, tmux, etc.).

This is a new channel alongside toast and ntfy, independently configurable via `terminalBell.enabled` in config.

## Motivation

PR [777genius/claude-notifications-go#94](https://github.com/777genius/claude-notifications-go/pull/94) highlighted that ai-agent-notifier lacks a terminal bell path. Terminal bell is a lightweight, zero-popup notification that works across all major terminals and is especially useful for multi-tab workflows.

## Architecture

### New file: `src/bell.mjs`

Exports a single function: `sendBell() -> Promise<boolean>`

Platform dispatch via `os.platform()`:
- **Windows (`win32`)**: `sendBellWindows()`
- **macOS/Linux (everything else)**: `sendBellUnix()`

### Windows path (`sendBellWindows`)

Claude Code hooks run with `CREATE_NO_WINDOW`, meaning the hook process has no console attached. Writing `\x07` to stdout does nothing — there's no console to receive it.

The solution:

1. **Walk the process tree** to find the ancestor PID that owns the terminal console. Use `wmic process where "ProcessId=<pid>" get ParentProcessId` (or PowerShell `(Get-Process -Id <pid>).Parent.Id`) to walk up from the current process until we find a process with a console window.
2. **`FreeConsole()`** — detach from any existing console (the invisible one created by `CREATE_NO_WINDOW`).
3. **`AttachConsole(ancestorPid)`** — attach to the ancestor terminal's console (the ConPTY that Windows Terminal uses).
4. **Write BEL** to `CONOUT$` — this rings the bell on the correct terminal tab.
5. **`FreeConsole()`** again — detach cleanly. The hook process doesn't need a console after this.

Implementation: spawn a small PowerShell script that performs steps 1-5 via .NET P/Invoke (`[Console]::Beep()` won't work — it plays a speaker tone, not a terminal bell). The script uses `Add-Type` to call `kernel32.dll` functions `FreeConsole`, `AttachConsole`, `CreateFileW` (for `CONOUT$`), and `WriteConsoleW`.

Primary strategy: use `AttachConsole(-1)` (attach to parent process's console) first — it's simpler and works in the common case where the hook's parent chain leads directly to the terminal. If `AttachConsole(-1)` fails (returns 0), walk the process tree upward using `Get-CimInstance Win32_Process` to find an ancestor with a console and retry with that PID.

### Unix path (`sendBellUnix`)

1. **Try `/dev/tty`** — open for writing, write `\x07`, close. This works when the hook has a controlling terminal.
2. **Fallback: tmux pane bell** — if `/dev/tty` fails (ENXIO, common for Claude Code hooks which detach from the terminal):
   - Check `$TMUX_PANE` is set (we're inside tmux).
   - Run `tmux display-message -p -t "$TMUX_PANE" '#{pane_tty}'` to get the pane's tty path.
   - Write `\x07` to that tty path.
   - This sets the tmux window bell flag, lighting up `window-status-bell-style`.
3. **If both fail**, return `false` silently.

### Config

```json
{
  "terminalBell": {
    "enabled": true
  }
}
```

Default: **enabled**. Terminal bell is cheap, non-intrusive, and universal.

Per-event override: `eventConfig.terminalBellEnabled` (boolean), following the same pattern as `toastEnabled` and `ntfyEnabled`.

### Dispatch integration (`src/notify.mjs`)

Add bell as a third channel in the existing `Promise.allSettled()` dispatch:

```javascript
if (config.terminalBell?.enabled !== false && eventConfig.terminalBellEnabled !== false) {
  tasks.push(sendBell());
}
```

### Failure mode

Best-effort, silent on failure. `sendBell()` returns `false` on any error, never throws. A failed bell never blocks other channels or the hook process.

## Files Changed

| File | Change |
|------|--------|
| `src/bell.mjs` | **New.** Platform-dispatching `sendBell()` function. |
| `src/notify.mjs` | Add bell to the channel dispatch block. |
| `config/default-config.json` | Add `"terminalBell": { "enabled": true }`. |
| `tests/bell.test.mjs` | **New.** Strict, no-mock tests for bell. |
| `tests/e2e/bell.e2e.test.mjs` | **New.** E2E subprocess test for bell integration. |

## Testing Strategy

### Philosophy: strict, real, no-mock, no-shotgun

Tests must:
- **Import and call real production functions.** No mocking `child_process`, no stubbing OS APIs.
- **Fail hard when the ideal case can't be tested.** If a required binary is missing or an API call fails, the test fails — it does not skip or degrade gracefully.
- **Test one thing one way.** No shotgun patterns (trying multiple approaches hoping one works). Each test asserts one specific behavior with one specific mechanism.
- **Verify actual side effects.** If the bell is supposed to write `\x07` to a file descriptor, verify the bytes were written.

### Unit tests (`tests/bell.test.mjs`)

#### Platform detection

```
it('sendBell calls the correct platform function based on os.platform()')
```

- Verify the function resolves to a boolean (true/false).
- On the current platform, verify the correct code path executed (not the other platform's path).

#### Windows-specific (run only on `win32`, fail-not-skip on Windows CI)

```
it('sendBellWindows attaches to ancestor console and writes BEL')
```

- Verify the PowerShell script executes without error.
- Verify the script's exit code is 0.
- Verify the script performs the `FreeConsole`/`AttachConsole` sequence (parse script output/logs).

```
it('sendBellWindows returns false when no ancestor console exists')
```

- Test the case where the process tree has no console (e.g., running in a windowless service context).

#### Unix-specific (run only on `darwin`/`linux`, fail-not-skip on Unix CI)

```
it('sendBellUnix writes BEL to /dev/tty when available')
```

- Open `/dev/tty` in the test, verify `\x07` can be written.
- If `/dev/tty` is not available (CI container), this test **fails** — CI must provide a tty.

```
it('sendBellUnix falls back to tmux pane when /dev/tty fails')
```

- Only runs when `$TMUX_PANE` is set. If not in tmux, test **fails** with a clear message — this test must run inside a tmux session in CI or be explicitly excluded by platform gate, not silently skipped.

```
it('sendBellUnix returns false when both /dev/tty and tmux fail')
```

- Run in an environment with no tty and no tmux. Verify `sendBell()` returns exactly `false`.

#### Config gating

```
it('sendBell is not called when terminalBell.enabled is false')
it('sendBell is not called when eventConfig.terminalBellEnabled is false')
it('sendBell is called when config has no terminalBell key (default enabled)')
```

- These test the dispatch logic in `notify.mjs`, not the bell function itself.
- Import the real `main()` or dispatch function, pass crafted config, verify bell was/wasn't invoked by checking the return value or channel results.

### E2E tests (`tests/e2e/bell.e2e.test.mjs`)

```
it('full hook invocation includes bell channel in output')
```

- Use the existing `runNode()` helper to spawn `src/notify.mjs` as a subprocess.
- Pass config with `terminalBell.enabled: true`.
- Pipe a valid event on stdin.
- Verify from stdout/stderr that the bell channel was attempted.

```
it('bell channel is excluded when disabled in config')
```

- Same subprocess invocation with `terminalBell.enabled: false`.
- Verify bell was not attempted.

### CI considerations

- Windows CI runners (GitHub Actions `windows-latest`) have a console. Bell tests should pass.
- Linux CI runners may not have a controlling tty in all configurations. The `/dev/tty` test must run in a context where a pty is allocated (e.g., `script -qc` wrapper), or be gated to only run when `/dev/tty` exists — **but if gated, it must fail, not skip**, when the gate condition is not met on a platform that should support it.
- tmux fallback tests require tmux installed. Gate on `which tmux` — if tmux is available but `$TMUX_PANE` is not set, the test should verify the "no tmux session" path, not skip.
