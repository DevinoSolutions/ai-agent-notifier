---
name: uninstall
description: Remove all ai-agent-notifier hooks from every AI tool
---

Remove all managed hooks from every tool's config. Execute this in the terminal:

```bash
node "${CLAUDE_PLUGIN_ROOT}/cli/index.mjs" uninstall
```

This cleanly removes hooks from Claude Code, Codex, Cursor, and Gemini. Original configs are backed up at `~/.ai-agent-notifier/backups/`.
