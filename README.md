<h1 align="center">ai-agent-notifier</h1>

<p align="center">
  <strong>Desktop & phone notifications for AI coding agents</strong><br />
  One tool. One config. Every agent. Never miss when your AI finishes or needs input.
</p>

<p align="center">
  <img src="assets/icons/claude.png" alt="Claude Code" width="36" />&nbsp;&nbsp;
  <img src="assets/icons/codex.png" alt="Codex CLI" width="36" />&nbsp;&nbsp;
  <img src="assets/icons/cursor.png" alt="Cursor" width="36" />&nbsp;&nbsp;
  <img src="assets/icons/gemini.png" alt="Gemini CLI" width="36" />&nbsp;&nbsp;
  <img src="assets/icons/vscode.png" alt="VS Code" width="36" />
</p>

<p align="center">
  <a href="https://github.com/DevinoSolutions/ai-agent-notifier/actions/workflows/ci.yml"><img src="https://github.com/DevinoSolutions/ai-agent-notifier/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/ai-agent-notifier"><img src="https://img.shields.io/npm/v/ai-agent-notifier?color=cb3837&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/ai-agent-notifier"><img src="https://img.shields.io/npm/dm/ai-agent-notifier?color=blue" alt="npm downloads" /></a>
  <a href="https://github.com/DevinoSolutions/ai-agent-notifier/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License: AGPL-3.0" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js >= 18" /></a>
  <img src="https://img.shields.io/badge/dependencies-zero-success" alt="Zero Dependencies" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Windows-0078D6?style=flat-square&logo=windows&logoColor=white" alt="Windows" />
  <img src="https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple&logoColor=white" alt="macOS" />
  <img src="https://img.shields.io/badge/Linux-FCC624?style=flat-square&logo=linux&logoColor=black" alt="Linux" />
  <img src="https://img.shields.io/badge/Android-3DDC84?style=flat-square&logo=android&logoColor=white" alt="Android" />
  <img src="https://img.shields.io/badge/iOS-000000?style=flat-square&logo=ios&logoColor=white" alt="iOS" />
</p>

---

## Quick Start

```bash
npx ai-agent-notifier setup
```

That's it. The setup wizard detects your platform and installed AI tools, wires the hooks, and optionally configures phone push notifications. Restart your AI tools to activate.

## Features

- **Desktop toast notifications** -- Windows (BurntToast), macOS (Notification Center), Linux (libnotify)
- **Phone push notifications** -- Android & iOS via [ntfy](https://ntfy.sh) (free, no account required)
- **Click-to-focus** -- click the toast to jump back to the terminal or VS Code window (Windows)
- **Per-tool branded icons** -- each tool gets its own logo in the notification
- **One unified config** -- shared `~/.ai-agent-notifier/config.json` across all tools
- **Atomic deduplication** -- prevents double notifications (e.g. Cursor's duplicate hook fires)
- **Zero dependencies** -- pure Node.js built-ins only, no npm production packages

## Supported Tools

<table>
  <tr>
    <th>Tool</th>
    <th>VS Code</th>
    <th>CLI</th>
    <th>Task Complete</th>
    <th>Needs Input</th>
  </tr>
  <tr>
    <td><img src="assets/icons/claude.png" width="18" />&nbsp; <strong>Claude Code</strong></td>
    <td align="center">Native</td>
    <td align="center">Native</td>
    <td><code>Stop</code></td>
    <td><code>Notification</code></td>
  </tr>
  <tr>
    <td><img src="assets/icons/codex.png" width="18" />&nbsp; <strong>Codex CLI</strong></td>
    <td align="center">Native</td>
    <td align="center">Native</td>
    <td><code>Stop</code></td>
    <td><code>PermissionRequest</code></td>
  </tr>
  <tr>
    <td><img src="assets/icons/cursor.png" width="18" />&nbsp; <strong>Cursor</strong></td>
    <td align="center">Native</td>
    <td align="center">--</td>
    <td><code>stop</code></td>
    <td>--</td>
  </tr>
  <tr>
    <td><img src="assets/icons/gemini.png" width="18" />&nbsp; <strong>Gemini CLI</strong></td>
    <td align="center">--</td>
    <td align="center">Native</td>
    <td><code>AfterAgent</code></td>
    <td><code>Notification</code></td>
  </tr>
</table>

All four tools are wired automatically by the setup wizard. No manual config editing needed.

### VS Code Native Support

Claude Code, Codex, and Cursor all run inside VS Code. **ai-agent-notifier** hooks directly into each tool's native hook system -- no VS Code extension required. The setup wizard detects installed tools and patches their configs automatically. Click a notification toast to jump straight back to your VS Code window.

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

## How It Works

Each AI tool's hook system pipes event data to `notify.mjs`:

```
Hook fires (stdin JSON + --source flag)
  -> parse-input.mjs   (normalize across tools)
  -> router.mjs        (map event to notification type)
  -> platform toast    (Windows / macOS / Linux)
  -> ntfy push         (phone notification)
```

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

## Uninstall

```bash
ai-agent-notifier uninstall
```

Removes all managed hooks from every tool's config. Original configs are backed up at `~/.ai-agent-notifier/backups/`.

## Testing

- `npm test` — fast, offline unit + integration suite.
- `npm run test:e2e` — real-world e2e (requires network): real ntfy.sh delivery,
  real `notify.mjs` invocation, and a real `setup` subprocess.

CI (`.github/workflows/ci.yml`) runs on Linux, macOS, and Windows: the unit
suite, the e2e suite, real installs + smoke-load of the agent CLIs, and
secret-gated live runs of Gemini (free tier) and Claude. The live jobs are
non-blocking and skip automatically when their API-key secrets are absent.

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

## License

[AGPL-3.0](LICENSE) -- Copyright (c) 2026 [DevinoSolutions](https://github.com/DevinoSolutions)
