<p align="center">
  <img src="assets/icons/claude.png" alt="ai-agent-notifier" width="80" />
</p>

<h1 align="center">ai-agent-notifier</h1>

<p align="center">
  <strong>Desktop & phone notifications for AI coding agents</strong><br />
  One tool. One config. Every agent. Never miss when your AI finishes or needs input.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ai-agent-notifier"><img src="https://img.shields.io/npm/v/ai-agent-notifier?color=cb3837&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/ai-agent-notifier"><img src="https://img.shields.io/npm/dm/ai-agent-notifier?color=blue" alt="npm downloads" /></a>
  <a href="https://github.com/DevinoSolutions/ai-agent-notifier/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License: AGPL-3.0" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js >= 18" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform: Windows | macOS | Linux" />
  <img src="https://img.shields.io/badge/dependencies-zero-success" alt="Zero Dependencies" />
</p>

---

## Why ai-agent-notifier?

AI coding agents run for minutes at a time. You tab away, check Slack, grab coffee -- then forget to come back. **ai-agent-notifier** sends you a desktop toast and/or phone push notification the moment your agent finishes a task or needs your input. Works with every major AI coding tool, on every platform, with zero npm dependencies.

## Supported AI Coding Tools

| Tool | VS Code | CLI | Task Complete | Needs Input |
|------|:-------:|:---:|--------------|-------------|
| **Claude Code** | Native | Native | `Stop` | `Notification` |
| **Codex CLI** | Native | Native | `Stop` | `PermissionRequest` |
| **Cursor** | Native | -- | `stop` | -- |
| **Gemini CLI** | -- | Native | `AfterAgent` | `Notification` |

All four tools are wired automatically by the setup wizard. No manual config editing needed.

### VS Code Native Support

Claude Code, Codex, and Cursor all run inside VS Code. **ai-agent-notifier** hooks directly into each tool's native hook system -- no VS Code extension required. The setup wizard detects installed tools and patches their configs automatically. Click a notification toast to jump straight back to your VS Code window.

## Features

- **Desktop toast notifications** -- Windows (BurntToast), macOS (Notification Center), Linux (libnotify)
- **Phone push notifications** -- via [ntfy](https://ntfy.sh) (free, no account required)
- **Click-to-focus** -- click the toast to jump back to the terminal or VS Code window (Windows)
- **Per-tool branded icons** -- each tool gets its own logo in the notification
- **One unified config** -- shared `~/.ai-agent-notifier/config.json` for all tools
- **Atomic deduplication** -- prevents double notifications (e.g. Cursor's duplicate hook fires)
- **Zero dependencies** -- pure Node.js built-ins only

## Quick Start

```bash
npx ai-agent-notifier setup
```

The setup wizard will:
1. Detect your platform and installed AI tools
2. Install the toast backend (BurntToast on Windows)
3. Configure ntfy push notifications (optional)
4. Wire hooks into each detected tool's config
5. Back up original configs before patching

## Installation

### npm (recommended)

```bash
# One-shot setup (no install needed)
npx ai-agent-notifier setup

# Or install globally
npm i -g ai-agent-notifier
ai-agent-notifier setup
```

### Claude Code Plugin

```
/install-plugin https://github.com/DevinoSolutions/ai-agent-notifier
```

Hooks auto-register. Use `/ai-agent-notifier:setup` to wire other tools.

### Standalone (no npm)

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/DevinoSolutions/ai-agent-notifier/main/setup/install.ps1 | iex
```

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/DevinoSolutions/ai-agent-notifier/main/setup/install.sh | bash
```

## CLI Commands

```
ai-agent-notifier setup          # First-time setup wizard
ai-agent-notifier status         # Show wired tools, config, backends
ai-agent-notifier test [channel] # Fire test notification (toast | ntfy | both)
ai-agent-notifier config         # Interactive settings menu
ai-agent-notifier uninstall      # Remove hooks from all tools
```

## How It Works

Each AI tool's hook system pipes event data to `notify.mjs`:

```
Hook fires (stdin JSON + --source flag)
  -> parse-input.mjs   (normalize across tools)
  -> router.mjs        (map event to notification type)
  -> platform toast    (Windows / macOS / Linux)
  -> ntfy push         (phone notification)
```

The `--source` flag identifies which tool fired:

```bash
node notify.mjs --source claude   # Claude Code
node notify.mjs --source codex    # Codex CLI
node notify.mjs --source gemini   # Gemini CLI
node notify.mjs --source cursor   # Cursor
```

## Configuration

Config lives at `~/.ai-agent-notifier/config.json`:

```json
{
  "ntfy": {
    "enabled": true,
    "server": "https://ntfy.sh",
    "topic": "ai-agent-notifier-<random>"
  },
  "toast": {
    "enabled": true,
    "clickToFocus": true
  },
  "events": {
    "task_complete": { "sound": "IM", "ntfyPriority": "default" },
    "needs_input": { "sound": "Reminder", "ntfyPriority": "urgent" },
    "session_start": { "sound": "Default", "ntfyPriority": "low" }
  }
}
```

### ntfy -- Phone Push Notifications

[ntfy](https://ntfy.sh) sends free push notifications to your phone -- no account needed.

1. Install the ntfy app ([Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) / [iOS](https://apps.apple.com/app/ntfy/id1625396347))
2. Subscribe to your topic (shown during setup)
3. All your AI tools' notifications appear in one stream

### Per-Event Settings

| Event | Default Sound | ntfy Priority | Description |
|-------|:------------:|:-------------:|-------------|
| `task_complete` | IM | default | Agent finished its task |
| `needs_input` | Reminder | urgent | Agent needs your input or permission |
| `session_start` | Default | low | New session started (disabled by default) |

## Platform Details

### Windows

- [BurntToast](https://github.com/Windos/BurntToast) PowerShell module for rich toast notifications
- Click-to-focus via custom `agentfocus://` URI protocol
- BurntToast auto-installed during setup if missing
- Requires PowerShell 7+ (pwsh)

### macOS

- Uses built-in `osascript` -- zero additional dependencies
- Falls back to `terminal-notifier` for richer features if available

### Linux

- Uses `notify-send` (libnotify) -- available on most desktop distributions
- Fails silently on headless or WSL systems without a GUI

## Requirements

| Requirement | Details |
|-------------|---------|
| **Node.js** | >= 18.0.0 (already present for all supported AI tools) |
| **Windows** | PowerShell 7+ (pwsh) |
| **macOS** | osascript (built-in) |
| **Linux** | notify-send (optional, for desktop toasts) |

## Zero Dependencies

Pure Node.js built-ins only -- no npm production dependencies. Uses `https`, `fs`, `path`, `child_process`, `readline`, and `os`.

## Uninstall

```bash
ai-agent-notifier uninstall
```

Removes all managed hooks from every tool's config. Original configs are backed up at `~/.ai-agent-notifier/backups/`.

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

## License

[AGPL-3.0](LICENSE) -- Copyright (c) 2026 [DevinoSolutions](https://github.com/DevinoSolutions)
