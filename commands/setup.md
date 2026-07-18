---
name: setup
description: Set up anotifier notifications for all AI tools
---

Run the anotifier setup wizard. Execute this command in the terminal:

```bash
node "${CLAUDE_PLUGIN_ROOT}/cli/index.mjs" setup
```

This will detect installed AI tools, configure toast notifications and ntfy push, and wire hooks for Claude Code, Codex, Gemini CLI, and Cursor.
