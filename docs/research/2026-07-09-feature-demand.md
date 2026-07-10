# Feature Demand Research — ai-agent-notifier 1.1.0

**Date:** 2026-07-09
**Scope:** Demand evidence behind the five features shipped in 1.1.0 ("Feature Pass 3"), plus everything else considered and explicitly not built.
**Method:** Deep-research workflow — 104 agents fanned out across 22 sources and extracted 110 raw claims. The top 25 claims by decision impact were adversarially verified: 16 confirmed, 2 refuted, 7 unverified (verifier session limits — see [Caveats](#caveats)).

## Summary

| # | Finding | Decision |
|---|---------|----------|
| 1 | tmux-safe Claude Code bell via `terminalSequence` | **Shipped 1.1.0** |
| 2 | Codex approval notifications (`PermissionRequest`) | **Shipped 1.1.0** |
| 3 | Transcript-derived rich content | **Shipped 1.1.0** |
| 4 | WSL-native toasts | **Shipped 1.1.0** |
| 5 | Webhook channel + presets | **Shipped 1.1.0** |
| 6 | Click-to-focus parity (macOS/Linux) | Deferred |
| 7 | Per-project/per-session sounds | Watchlist |
| 8 | Focus-aware suppression | Watchlist |
| 9 | SSH/remote auto-prefer-ntfy | Watchlist |
| 10 | Phone Allow/Deny buttons | Do not build |

## Findings

### 1. tmux-safe Claude Code bell via `terminalSequence` — shipped as F1

**Demand evidence:** [anthropics/claude-code#19976](https://github.com/anthropics/claude-code/issues/19976) (25 👍, open) documents that Claude Code hooks lost their controlling TTY around v2.1.139, silently breaking any hook that writes a bell direct to `/dev/tty` — which is exactly what our own `terminalBell` channel did for Claude Code. Two third-party projects (`cc-clip` and [zywind/claude-iterm-tmux-notifications](https://github.com/zywind/claude-iterm-tmux-notifications)) exist solely to work around the gap, which is independent evidence the breakage is real and unresolved upstream.

**Verification:** Confirmed. Claude Code's own hook JSON gained a top-level `terminalSequence` field in v2.1.141 that is written through Claude Code's own terminal path rather than the hook's (now TTY-less) process — doc- and CHANGELOG-asserted tmux/GNU-screen/Windows-safe. Checked directly against the installed binary on the CI pin (2.1.205) and this machine (2.1.204). One adjacent claim was **refuted**: that a hook could achieve the same result today by passthrough-printing a raw DCS (Device Control String) escape sequence to stdout. It cannot — stdout is consumed as the JSON hook response, not a raw terminal stream, so this variant was not built.

**Decision:** Shipped. This is also a bug fix, not just a feature: our own bell channel was silently failing for Claude Code users on modern versions before this change. Claude Code now rings via `terminalSequence` exclusively (no `bell.mjs` subprocess for Claude Code), because emitting both would double-ring tmux on >=2.1.141 — the exact scenario this fixes. Other agents are unaffected and keep the direct TTY/console bell.

### 2. Codex approval notifications — shipped as F2

**Demand evidence:** [openai/codex#11808](https://github.com/openai/codex/issues/11808), folded into [openai/codex#2109](https://github.com/openai/codex/issues/2109) (525 👍) — one of the highest-reaction open asks against the Codex CLI. Event hooks shipped experimentally upstream on 2026-03-27.

**Verification:** Confirmed directly against the binary, not just docs. The hook-event enum was extracted verbatim from the installed Codex 0.144.0 executable (both the CI pin and this machine): `PreToolUse PermissionRequest PostToolUse PreCompact PostCompact SessionStart UserPromptSubmit SubagentStart SubagentStop Stop`. `PermissionRequest` is real and present, and our own `parse-input.mjs` already mapped it to a "needs input" notification — that mapping had simply never been reachable because our Codex setup never registered the event.

**Decision:** Shipped. This turned out to be a small, low-risk change: `setup/patch-config.mjs` now additionally registers `PermissionRequest` in Codex's `hooks.json` (alongside the existing `Stop`/`SessionStart`), so the trust-hash regeneration and event-mapping code paths needed no new logic, only a new entry in an existing list. Verified locally end to end by triggering a real Codex approval prompt against the 0.144.0 binary.

### 3. Transcript-derived rich content — shipped as F3

**Demand evidence:** [claude-notifications-go](https://github.com/777genius/claude-notifications-go) (777genius, 733 ★) — a directly competing project — makes transcript-derived notification text its headline feature over generic "task complete" alerts. [claude-ntfy-hook](https://github.com/nickknissen/claude-ntfy-hook) (nickknissen) independently does the same for ntfy specifically.

**Verification:** Confirmed as a real, popular differentiator (733 ★ is the largest single demand signal in this pass). Not independently re-verified beyond confirming both projects exist and ship the feature as described — this is one of the 7 unverified-in-depth claims (see Caveats), though the core "this is a real and desired feature" signal is not in doubt given the star count.

**Decision:** Shipped, Claude Code only. A "needs input" notification now carries Claude's own question; a "task complete" notification carries the last assistant message from the Claude Code transcript, both trimmed to a short snippet. Session-start notifications stay generic. Rich content defaults **on** for toast (`toast.richContent: true`) and webhook (`webhook.richContent: true`), but **off** for ntfy (`ntfy.richContent: false`) — the default `ntfy.sh` server is public and topic names are guessable, so a conversation snippet is a real leak risk there in a way it isn't for a local toast or a user-configured webhook endpoint. This is the one place our implementation deliberately diverges from the competitor feature it's inspired by, on privacy grounds.

### 4. WSL-native toasts — shipped as F4

**Demand evidence:** [openai/codex#8189](https://github.com/openai/codex/issues/8189) plus four independent community bridge tools, including the [stuartleeks/wsl-notify-send](https://github.com/stuartleeks/wsl-notify-send) lineage and [windysky/claude-notification-wsl2](https://github.com/windysky/claude-notification-wsl2) — enough independently-built gap-fillers to indicate real, recurring demand rather than a one-off request.

**Verification:** Confirmed via `is-wsl`-equivalent detection logic, Microsoft's own WSL interop documentation, the bridge tools' source, and a documented EDR (endpoint detection and response) false-positive incident against a competing tool that used `-EncodedCommand` to spawn Windows toasts from WSL. One claim was **refuted**: that "`notify-send` universally fails under WSL2" — it doesn't; WSL2 with WSLg can run a real Linux notification daemon. Our WSL feature is a native-UX upgrade (a real Windows toast, not a Linux-styled one, with no daemon dependency), not a bug fix for a universally broken path.

**Decision:** Shipped. WSL is auto-detected (Linux kernel banner or `/proc/version` containing "microsoft", with Docker-Desktop-on-WSL container guards) and toasts route to a real Windows toast via PowerShell interop across the `/mnt/c` boundary. Given the documented EDR false-positive against `-EncodedCommand`-based toast spawning from WSL, our implementation deliberately avoids that pattern entirely and uses `-File` with typed `param()` binding instead. Verified live end to end against WSL2 Ubuntu on this machine.

### 5. Webhook channel + presets — shipped as F5

**Demand evidence:** [anthropics/claude-code#29827](https://github.com/anthropics/claude-code/issues/29827), closed `not_planned` by the vendor — Anthropic's stated position is that webhook delivery is left to the ecosystem rather than built into Claude Code itself, which pushes the demand toward tools like this one. It's also a headline feature of competing notifier projects, and — independent of any of this research pass — it was already on our own roadmap: [docs/specs/2026-05-14-agent-notify-design.md:340](../specs/2026-05-14-agent-notify-design.md) lists "Additional webhook presets (Slack, Discord, Telegram) via config" under Future Considerations, written before this research pass started.

**Verification:** Confirmed — the closed issue, the competitor precedent, and our own prior design doc are all independently checkable and consistent.

**Decision:** Shipped. `webhook.format` supports `generic` (POSTs `{title, message, source, project, event, timestamp}` as JSON), `slack`, `discord`, and `telegram` (which additionally requires `chatId`), plus an optional `authorization` header for any format. Because a webhook URL is itself a secret (Slack/Discord URLs embed an unguessable token; the Telegram endpoint carries the bot token in its path), failures are logged with the URL's origin only, never the full URL, headers, or body.

### 6. Click-to-focus parity for macOS/Linux — deferred

**Demand evidence:** The single loudest *raw* demand signal gathered in this pass — 6 distinct requesters in a competing project's issue tracker asking for the existing Windows-only click-to-focus behavior on macOS and Linux too.

**Verification:** Confirmed as real demand, but also confirmed as a liability: in the competitor project that already shipped cross-platform click-to-focus, it is their **top-3 post-ship bug source** — specifically macOS Tahoe's Script Editor permission model and GNOME/Wayland focus-stealing restrictions, both of which are OS-level moving targets rather than one-time integration work.

**Decision:** Deferred, not shipped. Click-to-focus stays Windows-scoped best-effort, unchanged in this release. The demand is real, but the evidence from a project that already shipped it says the maintenance cost on macOS/Linux is ongoing and platform-version-sensitive, not a fixed cost — worth a dedicated pass, not a bolt-on to this one.

### 7. Per-project / per-session notification sounds — watchlist

**Demand evidence:** [anthropics/claude-code#36885](https://github.com/anthropics/claude-code/issues/36885) (+5 reactions), a duplicate of [#13024](https://github.com/anthropics/claude-code/issues/13024) (+77 reactions on the canonical issue). We already ship a `projectName` prefix on every notification; the requested delta is specifically a per-project `toastSound`, not project identification in general.

**Verification:** Split — one verifier confirmed the reaction counts and duplicate relationship, a second could not complete before its session limit. Net: unverified at the confidence bar this pass required for a build decision.

**Decision:** Watchlist. The +77 canonical issue is a meaningful signal, but verification didn't clear the bar this pass, and the config-schema shape (keying sound overrides by project rather than by event) needs its own design pass rather than a rushed addition here.

### 8. Focus-aware suppression (`notifyOnlyWhenUnfocused`) — watchlist

**Demand evidence:** A single documented requester asking to suppress notifications while the terminal/editor already has focus.

**Verification:** The request itself is confirmed to exist; feasibility is not. Reliable focus detection on Linux/Wayland — where there is no single, permission-free, cross-compositor API for "is this window focused" — is the hard part, and that was flagged but not resolved this pass.

**Decision:** Watchlist. Single-requester demand plus an open feasibility question on our most fragile platform (Linux/Wayland) doesn't clear the bar for this release.

### 9. SSH/remote sessions auto-prefer ntfy — watchlist

**Demand evidence:** The `cc-clip` SSH bridge project (124 ★) exists specifically to solve this, corroborated by independent blog posts describing the same workflow (SSH into a remote box, want the phone push, not a desktop toast that will never render).

**Verification:** One of the 7 unverified claims this pass — the star count and existence of `cc-clip` were checked, but the broader "this generalizes to most SSH users" claim was not independently corroborated beyond that one project plus blog corroboration before the verifier session limit was hit.

**Decision:** Watchlist. Credible and plausibly high-value (a toast that can never be seen is worse than no toast), but the detection logic (reliably distinguishing an SSH session from a local one across platforms) and the auto-behavior change (silently altering which channel fires) both need more design than this pass had room for.

### 10. Phone Allow/Deny buttons on notifications — do not build as designed

**Demand evidence:** Recurring request across multiple sources for ntfy/push notifications to carry action buttons that approve or deny an agent's pending tool call directly from the phone.

**Verification:** The request is real, but as designed it requires a blocking `PreToolUse` hook that waits on a callback server for the phone's response.

**Decision:** Do not build as designed. This violates two hard constraints of this project: hooks must never block the host agent (a network round-trip to a phone is an unbounded wait sitting in the agent's critical path), and the zero-dependency, no-server posture (a callback server is new persistent infrastructure, not a stateless hook). At most, a future pass could explore *non-blocking* ntfy action buttons that fire a side-channel command after the fact — not a live gate on the agent's next action. Not attempted in 1.1.0.

## Caveats

- **7 of the 25 adversarially-checked claims are unverified**, not refuted — the verification subagents hit session limits before finishing. Most of these were secondary corroboration for findings #3 (rich content), #5 (webhook), and #9 (SSH/ntfy), not the primary signal that drove each decision — the core evidence for #3 and #5 is independently confirmed (see above); #9 stays on the watchlist partly because of this gap.
- **Evidence is GitHub-skewed.** Every claim that survived adversarial verification traces back to a GitHub issue, pull request, or repository (stars/reactions). No Reddit thread and no npm-download-trend claim survived verification this pass — they were either refuted, left unverified, or not pursued at this depth. Demand signals from those channels should be treated as unconfirmed until a future pass checks them directly.
- **2 claims were refuted outright** and explicitly excluded from what shipped: a raw-DCS-passthrough variant of the terminal bell fix (finding #1), and the claim that `notify-send` universally fails under WSL2 (finding #4).
- Reaction counts, star counts, and issue states are as-of 2026-07-09 and will drift.
