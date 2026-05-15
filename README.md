# ai-agent-notifier

Cross-platform notifications for AI coding agents. One tool, one config, every agent.

Never miss when Claude Code, Codex, Gemini CLI, or Cursor finishes a task or needs your input.

## What It Does

- **Desktop toast notifications** — Windows (BurntToast), macOS (Notification Center), Linux (libnotify)
- **Phone push notifications** — via [ntfy](https://ntfy.sh) (free, no account required)
- **Click-to-focus** — click the toast to jump back to the terminal/IDE window (Windows)
- **One config for all tools** — shared `~/.ai-agent-notifier/config.json`

## Supported Tools

| Tool | Task Complete Event | Needs Input Event |
|------|-------------------|------------------|
| Claude Code | `Stop` | `Notification` |
| Codex CLI | `Stop` | `PermissionRequest` |
| Gemini CLI | `AfterAgent` | `Notification` |
| Cursor IDE | `stop` | `notification` |

## Quick Start

```bash
npx ai-agent-notifier setup
```

The setup wizard will:
1. Detect your platform and installed AI tools
2. Install toast backend (BurntToast on Windows)
3. Configure ntfy push notifications (optional)
4. Wire hooks into each detected tool's config
5. Back up original configs before patching

## Install Methods

### npm (recommended)

```bash
# One-shot setup (no global install)
npx ai-agent-notifier setup

# Or install globally
npm i -g ai-agent-notifier
ai-agent-notifier setup
```

### Claude Code Plugin

Install directly in Claude Code:

```
/install-plugin https://github.com/DevinoSolutions/ai-agent-notifier
```

Hooks auto-register. Use `/ai-agent-notifier:setup` to wire other tools.

### Standalone (no npm)

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/DevinoSolutions/ai-agent-notifier/main/setup/install.ps1 | iex
```

**macOS/Linux:**
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

Each AI tool's hook system pipes JSON to `notify.mjs` on stdin:

```
Hook Event (stdin JSON)
  → parse-input.mjs  (normalize across tools)
  → router.mjs       (map to notification type)
  → platform toast   (Windows/macOS/Linux)
  → ntfy push        (phone notification)
```

Hook commands use `--source` to identify the tool:

```bash
node ~/.ai-agent-notifier/src/notify.mjs --source claude
node ~/.ai-agent-notifier/src/notify.mjs --source codex
node ~/.ai-agent-notifier/src/notify.mjs --source gemini
node ~/.ai-agent-notifier/src/notify.mjs --source cursor
```

## Configuration

Config lives at `~/.ai-agent-notifier/config.json`:

```json
{
  "ntfy": {
    "enabled": true,
    "server": "https://ntfy.sh",
    "topic": "ai-agent-notifier-<random>",
    "icon": "https://claude.ai/images/claude_app_icon.png"
  },
  "toast": {
    "enabled": true,
    "clickToFocus": true
  },
  "events": {
    "task_complete": { "sound": "IM", "ntfyPriority": "default" },
    "needs_input": { "sound": "Reminder", "ntfyPriority": "urgent" }
  }
}
```

### ntfy Phone Notifications

[ntfy](https://ntfy.sh) sends free push notifications to your phone — no account needed.

1. Install the ntfy app ([Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) / [iOS](https://apps.apple.com/app/ntfy/id1625396347))
2. Subscribe to your topic (shown during setup)
3. All your AI tools' notifications appear in one stream

The setup wizard generates a random topic and shows a subscription link.

### Per-Event Settings

Each event type can be configured independently:

| Event | Default Sound | ntfy Priority | Description |
|-------|--------------|---------------|-------------|
| `task_complete` | IM | default | Agent finished its task |
| `needs_input` | Reminder | urgent | Agent needs your input/permission |
| `session_start` | Default | low | New session started (disabled by default) |

## Platform Details

### Windows

- Uses [BurntToast](https://github.com/Windos/BurntToast) PowerShell module for rich toast notifications
- Click-to-focus via custom `agentfocus://` URI protocol — clicks the toast to bring your terminal/IDE to the foreground
- BurntToast auto-installed during setup if missing

### macOS

- Uses built-in `osascript` — zero dependencies
- Falls back to `terminal-notifier` for richer features if available

### Linux

- Uses `notify-send` (libnotify) — available on most desktop distributions
- Fails silently on headless/WSL systems without GUI

## Requirements

- **Node.js 18+** (already present for all four AI tools)
- **Windows:** PowerShell 7+ (pwsh)
- **macOS:** osascript (built-in)
- **Linux:** notify-send (optional)

## Zero Dependencies

Pure Node.js built-ins only — no npm production dependencies. Uses `https`, `fs`, `path`, `child_process`, `readline`, and `os`.

## Uninstall

```bash
ai-agent-notifier uninstall
```

Removes all managed hooks from every tool's config. Original configs are backed up at `~/.ai-agent-notifier/backups/`.

## License

MIT
