# macOS Real-UX Coverage — Evidence Record

**Date:** 2026-07-11
**Pass:** mac-real-ux
**Sources:** four research subagents (repo-mac-inventory, macos-runner-research,
codex-decision-research, mac-demand-evidence) + two on-runner spikes
(`spike-mac-delivery.yml`, runs `29163082947` and `29163259193`, macos-15 /
macOS 15.7.7).

---

## 1. The honest problem: exit 0 ≠ delivered

Our macOS toast path (`src/platforms/macos.mjs`) resolves `!err` — the
`osascript` exit code — and `src/notify.mjs` reports that as channel `ok:true`.
`osascript display notification` exits 0 even when the notification is silently
dropped (unauthorized sender), suppressed by Focus/DND, or rendered nowhere. A CI
suite that asserts "osascript exited 0" stays green while every user-visible
failure below ships.

### Field evidence (mac-demand-evidence)
- **Unauthorized sender → silent drop (most common).** `gsd-build/gsd-2#2632`
  (first-party): *"exits 0 (no error) but the notification is silently dropped by
  macOS if the calling terminal app doesn't have notification permissions. Most
  terminal apps don't appear in Settings until they've delivered at least one
  notification — a chicken-and-egg problem."* Corroborated: terminal-notifier
  #307/#312, node-notifier #47/#272/#407.
- **OSC/BEL swallowed by non-native terminals.** claude-code #28338 (VS Code
  drops CC's OSC seqs; "No error is shown"), #2716 (bell silent in
  Windsurf/Ghostty), gemini-cli #16280.
- **Wrong-app attribution ("Script Editor").** opencode #23446. Do NOT use
  `-sender` (conflicts with `-activate` on Sequoia 15.x+).
- **DND/Focus auto-suppression** (incl. auto-Focus during screen share).
- Demand scale: gemini-cli #4310 👍74, codex #4306 👍19; a swarm of third-party
  band-aids. A truthful CI suite is worth building.

## 2. Mechanism researched: NC delivery DB (macos-runner-research)

macOS *is documented* to log every delivered notification in a SQLite DB
(`~/Library/Group Containers/group.com.apple.usernoted/db2/db` on Sequoia;
`$(getconf DARWIN_USER_DIR)com.apple.notificationcenter/db2/db` pre-Sequoia),
including when the banner is suppressed by DND. SIP is disabled on hosted
macos-13+ runners, so a job can self-grant Full Disk Access via `TCC.db`.

## 3. Codex approval loop is a returnable decision (codex-decision-research)

Codex ships an official `[hooks]` `PermissionRequest` **Command hook** that may
print `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"|"deny"}}}`
and codex obeys it (empty output → prompt; crash → fail-open). Symmetric to Claude
Code's PermissionRequest hook. Lets a codex CI lane prove the full loop
(requested → decision → obeyed → sentinel). Deterministic fallback if `codex
exec` doesn't surface approvals: the `codex proto` `ExecApprovalRequest` →
`Op::ExecApproval` exchange. Shipped product stays notify-only this pass; the
decision-returning hook is CI harness only.

---

## 4. SPIKE FINDINGS (the decisive, surprising part)

Two spikes ran on macos-15 (macOS 15.7.7). Raw logs are in the run artifacts
(`29163082947`, `29163259193`).

### What works (read side)
- **SIP disabled** (`csrutil status` → disabled).
- **Sequoia DB exists at the expected path and is world-readable
  (`-rw-r--r--`, 127 KB) with NO FDA grant needed.** `ncDbPath()`'s Sequoia-first
  ordering is correct. The FDA self-grant is unnecessary on the runner.
- **`record` table schema:**
  `record(rec_id INTEGER PRIMARY KEY, app_id INTEGER, uuid BLOB, data BLOB,
  request_date REAL, request_last_date REAL, delivered_date REAL, presented Bool,
  style INTEGER, snooze_fire_date REAL)`. `rowid` = `rec_id`; content is the
  `data` bplist BLOB. Other tables: `app`(55 rows), `delivered`(1, **no `data`
  col**), `displayed`(1), `requests`(0), `snoozed`(0), `categories`(24).

### What does NOT work (the showstopper for headless positive proof)
- **`plutil -convert json` FAILS on real records** (`invalid object in plist for
  destination format`) because NC record bplists contain `NSDate`/`NSData`. The
  keystone's `decodeRecordPlist` uses json → returns null for every real record.
  **Must switch to `plutil -convert xml1` + regex, or a raw-buffer scan.**
- **Notifications are NOT recorded on a hosted runner — by any sender.**
  - `record` baseline = 1 (a pre-baked system "Tips" / `com.apple.tips` /
    `WhatsNewInMacOS` notification, dated the image-build date).
  - After firing our real `osascript display notification` with a unique marker:
    `record` count **still 1**; full `.dump` grep = **0** hits; BLOB scan = **0**.
  - After `brew install terminal-notifier` + firing a unique marker: `record`
    count **still 1**; BLOB scan = **0**.
  - `delivered`/`displayed` counts did not move either.
- **Conclusion:** a hosted GitHub macOS runner has **no live Notification Center
  session (`usernoted`)** processing/recording deliveries (no Aqua loginwindow
  session). Reading the DB works; nothing new ever gets written. The DB's single
  row is baked into the image, not a live delivery.
- **`ncprefs` is unreadable on the runner** (`plutil -convert json` → unreadable;
  `defaults read com.apple.ncprefs` not confirmed), so `notificationAuthState()`
  correctly returns `unknown` there.

### Implication
The approved design's central macOS assertion — *"fire our real `sendToast()`,
then match the exact payload in the NC delivery DB"* — **cannot pass on hosted
runners**, and neither can the NC-record legs added to the Claude/Gemini/Codex
lanes. This is the runner environment, not a bug. Forcing it = permanently-red
required check OR a faked green — both violate this pass's honesty principle.

### What remains true and provable headlessly
- The NC DB **read + decode machinery** works against the real system record
  (once the decoder is fixed to xml1/raw-buffer). Unit-testable on a captured
  real fixture.
- **ntfy push delivery** from real agents on macos-15 works (the existing lanes'
  `pollForPush` assertion) — proves the real hook fires on a real Mac.
- **tmux `window_bell_flag`** (F1) and **codex approval loop** (F2) are
  tmux-sensed, **not** NC-dependent — unaffected by this finding.
- `aan doctor --deep` genuinely verifies delivery **on a developer's real Mac**
  (live `usernoted`) — real product value, just not CI-gateable on hosted runners.

## 5. Non-goals (unchanged; confirmed by spikes)
Banner-pixel/screenshot gating (overlays don't composite in `screencapture`),
sound acoustics (no audio device), notification click/UI-scripting. Captured as
artifacts only, never gated.
