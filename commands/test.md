---
name: test
description: Fire a test notification to verify anotifier is working
---

Send a test notification through all enabled channels. Execute this in the terminal:

```bash
node "${CLAUDE_PLUGIN_ROOT}/cli/index.mjs" test
```

This fires a test toast, ntfy push, webhook, and terminal bell (each only if enabled/configured) to verify everything is wired correctly. Pass a channel name to test one: `toast | ntfy | webhook | bell`.
