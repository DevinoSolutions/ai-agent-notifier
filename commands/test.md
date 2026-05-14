---
name: test
description: Fire a test notification to verify ai-agent-notifier is working
---

Send a test notification through all channels. Execute this in the terminal:

```bash
node "${CLAUDE_PLUGIN_ROOT}/cli/index.mjs" test
```

This sends a test toast notification and ntfy push to verify everything is wired correctly.
