# agent-notify Design Spec

> Cross-platform notifications for AI coding agents.
> One tool, one config, every agent.

## Problem

AI CLI agents (Claude Code, Codex, Gemini CLI, Cursor) run long tasks where the user walks away. None ship adequate notification support. Users miss when tasks complete or when the agent needs input. Each tool has its own hook system but no shared notification layer exists.

## Solution

`agent-notify` is an npm package that provides:
- **Platform-native toast notifications** (Windows BurntToast, macOS Notification Center, Linux libnotify)
- **Phone push notifications** via ntfy (or any webhook)
- **One unified config** shared across all four AI tools
- **A CLI** for setup, configuration, testing, and status

## Supported Tools

| Tool | Hooks | Notify Event | Complete Event | Config Location |
|---|---|---|---|---|
| Claude Code | `settings.json` | `Notification` | `Stop` | `~/.claude/settings.json` |
| Codex CLI | `hooks.json` + `config.toml` | `PermissionRequest` | `Stop` | `~/.codex/hooks.json` |
| Gemini CLI | extension hooks | `Notification` | `AfterAgent` | `~/.gemini/hooks.json` |
| Cursor IDE | `hooks.json` | `notification` | `stop` | `~/.cursor/hooks.json` |

All four tools send JSON on stdin to hook commands with at minimum `session_id`, `cwd`, and event name.

## Architecture

### Repository Structure

```
agent-notify/
├── src/
│   ├── notify.mjs               # Entry point — reads stdin, dispatches
│   ├── parse-input.mjs          # Normalizes stdin JSON across all 4 tools
│   ├── router.mjs               # Maps hook events to notification types
│   ├── ntfy.mjs                 # ntfy/webhook sender (pure Node https)
│   └── platforms/
│       ├── windows.mjs          # Spawns PowerShell -> BurntToast toast
│       ├── macos.mjs            # osascript -> Notification Center
│       └── linux.mjs            # notify-send (libnotify)
├── assets/
│   ├── windows/
│   │   ├── toast.ps1            # BurntToast toast with click-to-focus
│   │   ├── focus.vbs            # Zero-window launcher
│   │   └── focus-window.ps1     # Win32 EnumWindows -> SetForegroundWindow
│   └── icon.png                 # Downloaded at setup time
├── setup/
│   ├── install.ps1              # Windows standalone installer (fallback)
│   ├── install.sh               # macOS/Linux standalone installer (fallback)
│   └── patch-config.mjs         # Safely merges hooks into each tool's config
├── cli/
│   ├── index.mjs                # CLI entry point (bin)
│   ├── setup.mjs                # Interactive setup wizard
│   ├── config.mjs               # Interactive settings menu
│   ├── status.mjs               # Show wired tools and config
│   ├── test.mjs                 # Fire test notifications
│   └── uninstall.mjs            # Clean removal from all tools
├── .claude-plugin/
│   ├── plugin.json              # Claude Code plugin manifest
│   └── marketplace.json
├── hooks/
│   └── hooks.json               # Claude Code plugin hook definitions
├── commands/
│   ├── setup.md                 # /agent-notify:setup slash command
│   └── test.md                  # /agent-notify:test slash command
├── config/
│   └── default-config.json      # Default notification preferences
├── package.json
├── README.md
├── LICENSE
└── .gitignore
```

### Data Flow

```
AI Tool Hook Event
       │
       ▼
  stdin (JSON)  ──→  notify.mjs --source <tool>
                          │
                          ├──→ parse-input.mjs  (normalize across tools)
                          │         │
                          │         ▼
                          │    Normalized Event:
                          │    { source, event, cwd, projectName, sessionId }
                          │
                          ├──→ router.mjs  (map event to notification config)
                          │         │
                          │         ▼
                          │    { title, message, sound, priority, tags }
                          │
                          ├──→ platforms/<platform>.mjs  (native toast)
                          │
                          └──→ ntfy.mjs  (phone push / webhook)
```

### Normalized Event Schema

```json
{
  "source": "claude | codex | gemini | cursor",
  "event": "task_complete | needs_input | session_start | error",
  "cwd": "/path/to/project",
  "projectName": "my-project",
  "sessionId": "abc-123",
  "rawEvent": "Stop | Notification | AfterAgent | etc",
  "raw": {}
}
```

### Event Mapping

| Normalized Event | Claude Code | Codex | Gemini | Cursor |
|---|---|---|---|---|
| `task_complete` | `Stop` | `Stop` | `AfterAgent` | `stop` |
| `needs_input` | `Notification` | `PermissionRequest` | `Notification` | `notification` |
| `session_start` | `SessionStart` | `SessionStart` | `SessionStart` | -- |

### Source Detection

Each tool's hook command includes a `--source` flag:

```
node ~/.agent-notify/src/notify.mjs --source claude
node ~/.agent-notify/src/notify.mjs --source codex
node ~/.agent-notify/src/notify.mjs --source cursor
node ~/.agent-notify/src/notify.mjs --source gemini
```

When installed via npm global, the hook commands resolve `notify.mjs` from the npm package path (e.g. `node /usr/lib/node_modules/agent-notify/src/notify.mjs`). When installed standalone, commands use `~/.agent-notify/src/notify.mjs`. The `patch-config.mjs` module detects which install method was used and writes the correct path into each tool's hooks.

## Notification Backends

### Windows (BurntToast)

- `toast.ps1` renders rich Windows toast via BurntToast PowerShell module
- Custom icon (claude-logo.png or agent-notify icon)
- Sound selection per event type
- Click-to-focus via `agentfocus://` custom URI protocol:
  - `focus.vbs` launches `focus-window.ps1` in a zero-window shell
  - `focus-window.ps1` uses Win32 `EnumWindows` + `SetForegroundWindow` to find and focus the terminal/IDE window matching the project name
  - Searches terminal emulators first (Windows Terminal, pwsh, Warp, etc.), then VS Code, then any matching window
- BurntToast installed automatically during setup if missing

### macOS (Notification Center)

- `osascript -e 'display notification "msg" with title "title" sound name "sound"'`
- Zero dependencies — built into macOS
- If `terminal-notifier` is detected, uses it for richer features (custom icons, click actions)
- Click action via AppleScript `activate` on the matching terminal/IDE window

### Linux (libnotify)

- `notify-send "title" "msg" --icon=path --urgency=level`
- Available on most desktop Linux distributions
- Falls back silently if `notify-send` not found (headless servers, WSL without GUI)

### ntfy / Webhooks (all platforms)

- Pure Node.js `https.request` — zero dependencies
- Sends to configurable ntfy server + topic
- Per-event priority and tags
- Custom icon URL and click-through URL
- One unified topic for all tools — phone gets a single notification stream
- Configurable per-event: can disable webhook for noisy events while keeping toast

## Configuration

Location: `~/.agent-notify/config.json`

```json
{
  "ntfy": {
    "enabled": true,
    "server": "https://ntfy.sh",
    "topic": "agent-notify-<random-16-chars>",
    "icon": "https://claude.ai/images/claude_app_icon.png",
    "click": "https://claude.ai/"
  },
  "toast": {
    "enabled": true,
    "clickToFocus": true
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
    }
  },
  "sources": {
    "claude": { "label": "Claude Code" },
    "codex": { "label": "Codex" },
    "gemini": { "label": "Gemini" },
    "cursor": { "label": "Cursor" }
  }
}
```

- Preserved across updates
- Generated with random topic on first install
- Migrates existing `~/.claude/ntfy-config.json` topic if found

## CLI Interface

```
agent-notify <command> [options]

Commands:
  setup                 First-time setup wizard
  status                Show wired tools, ntfy topic, toast backend
  test [channel]        Fire test notification (toast | ntfy | both)
  config                Interactive settings menu
  config ntfy           Configure ntfy (topic, server, priority mapping)
  config sounds         Configure per-event sounds
  config tools          Enable/disable per-tool integration
  config events         Toggle which events trigger notifications
  uninstall             Remove hooks from all tools, clean up
```

### Install Methods

**Primary (npm):**
```bash
npx agent-notify setup        # one-shot, no global install
# or
npm i -g agent-notify          # global install
agent-notify setup
```

**Fallback (standalone scripts):**
```powershell
# Windows
irm https://raw.githubusercontent.com/DevinoSolutions/agent-notify/main/setup/install.ps1 | iex
```
```bash
# macOS/Linux
curl -fsSL https://raw.githubusercontent.com/DevinoSolutions/agent-notify/main/setup/install.sh | bash
```

### Setup Wizard Flow

1. Detect platform (Windows/macOS/Linux)
2. Detect installed AI tools (Claude, Codex, Gemini, Cursor)
3. Install platform toast backend (BurntToast on Windows)
4. Download notification icon
5. Prompt for ntfy configuration (enable/disable, server, topic)
6. Generate or migrate ntfy topic
7. Patch each detected tool's config with notification hooks
8. Back up original configs to `~/.agent-notify/backups/`
9. Show QR code for ntfy phone subscription
10. Print summary

### Config Patching Safety (`patch-config.mjs`)

- Always reads existing config first
- Never overwrites non-notification keys
- Backs up original file before first patch
- Idempotent — safe to re-run
- Tags managed hooks so uninstall knows what to remove
- Per-tool patching logic:

| Tool | Config Format | Patch Strategy |
|---|---|---|
| Claude Code | `settings.json` (JSON) | Merge into `hooks.Notification` and `hooks.Stop` arrays |
| Codex | `hooks.json` (JSON) + `config.toml` (TOML) | Create/merge hooks.json, append `codex_hooks = true` to config.toml |
| Gemini | `hooks.json` (JSON) | Create/merge hooks following Gemini extension format |
| Cursor | `hooks.json` (JSON) | Merge with `_managed_by: "agent-notify"` tag |

## Claude Code Plugin

Thin convenience layer for Claude Code users who prefer plugin install.

**plugin.json:**
```json
{
  "name": "agent-notify",
  "version": "1.0.0",
  "description": "Cross-platform notifications for AI coding agents",
  "author": { "name": "DevinoSolutions" },
  "repository": "https://github.com/DevinoSolutions/agent-notify",
  "commands": ["./commands/setup.md", "./commands/test.md"]
}
```

**hooks.json:**
```json
{
  "hooks": {
    "Notification": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/src/notify.mjs\" --source claude",
        "timeout": 10
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/src/notify.mjs\" --source claude",
        "timeout": 10
      }]
    }]
  }
}
```

When installed as a plugin, Claude Code hooks are auto-registered. The `/agent-notify:setup` slash command additionally wires Codex/Gemini/Cursor if detected.

## Dependencies

**Production:** Zero. Pure Node.js built-ins only (`https`, `fs`, `path`, `child_process`, `readline`, `os`).

**Platform requirements:**
- Windows: PowerShell 7+, BurntToast module (auto-installed)
- macOS: osascript (built-in)
- Linux: notify-send (optional, fails silently)
- All: Node.js 18+ (already present for all four AI tools)

## Non-Goals

- No audio/TTS notifications (keep it simple — toast + push)
- No web dashboard or analytics
- No compiled binary — Node.js is sufficient and already available
- No support for tools without hook systems (Aider, etc.)
- No Windows PowerShell 5.1 support — PowerShell 7+ only

## Future Considerations

- Additional webhook presets (Slack, Discord, Telegram) via config
- Per-project notification rules (quiet mode for certain repos)
- Notification grouping/debouncing for rapid-fire events
- Additional AI tools as they add hook support
