---
name: config
description: Open the interactive settings menu to configure notifications
---

Open the ai-agent-notifier interactive configuration menu. Execute this in the terminal:

```bash
node "${CLAUDE_PLUGIN_ROOT}/cli/index.mjs" config
```

Sections: `ntfy` (push notification settings), `webhook` (Slack/Discord/Telegram/generic endpoint), `sounds` (per-event `toastSound` values, Windows BurntToast only), `events` (per-event overrides), `sentry` (opt-in error reporting).
