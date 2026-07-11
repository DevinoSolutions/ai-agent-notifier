# macOS Real-UX Coverage

**Date:** 2026-07-11
**Status:** Approved
**Branch:** `feat/mac-real-ux`

## Overview

Make CI fail whenever a real Mac user would have seen or heard nothing. Today the
only macOS proof is `osascript` exiting 0 — which it also does when the
notification is silently dropped (no notification permission), suppressed by
Focus/DND, or rendered nowhere. This pass replaces exit-code proofs with
assertions on **OS-observable state**: Notification Center's delivered-records
database, tmux bell flags, and sentinel files created by real agent runs.

One new module provides delivery verification; a new `aan doctor` command ships
it to users as a product feature; five CI lanes assert through it on real
macOS runners with real agents (Claude, Gemini, Codex).

## Motivation

The evidence pass (see `docs/research/2026-07-11-macos-real-ux-evidence.md`)
established that the dominant real-world macOS failure is **exit 0 with no
banner**:

- `display notification` via `osascript` is attributed to Script Editor (or the
  invoking terminal app); if that app is not authorized in Notification Center,
  the notification is dropped **silently** — the AppleScript still succeeds.
- Focus/DND suppresses banners while the send succeeds.
- IDE-integrated terminals (VS Code, Windsurf) swallow BEL/OSC sequences, so the
  terminal-bell channel can be a no-op exactly where many users run agents.
- `src/platforms/macos.mjs` resolves `!err` — a boolean of the exit code — and
  `src/notify.mjs` reports that as channel `ok:true`. Structural invisibility.
- Bonus bug: default config ships Windows sound names (`"IM"`, `"Reminder"`)
  which are forwarded to macOS as invalid `sound name` arguments, while
  `README.md` claims `toastSound` is "ignored on macOS/Linux" — both wrong.

The Linux lane already solved this class of problem: `scripts/live-toast-linux.mjs`
fires the real backend and asserts exact title/body from dunst's history. This
design is the macOS port of that pattern, plus the agent-level ladder on top.

### Key platform facts (from the research reports; re-verified by the spike)

- Notification Center logs every **delivered** notification in a SQLite DB —
  including when the banner is suppressed by DND (delivered ≠ displayed, which
  is exactly the honest boundary we can prove headlessly):
  - macOS 15 (Sequoia): `~/Library/Group Containers/group.com.apple.usernoted/db2/db`
  - macOS 13/14: `$(getconf DARWIN_USER_DIR)com.apple.notificationcenter/db2/db`
  - `record` table rows hold a binary plist BLOB with `req.titl`, `req.body`,
    the owning app reference, and a delivery date.
- Hosted GitHub runners (macos-13 and later) run with **SIP disabled**, so a job
  can self-grant Full Disk Access by inserting a `kTCCServiceSystemPolicyAllFiles`
  row into the system `TCC.db` and `sudo pkill -HUP tccd` — making the NC DB
  readable without a consent dialog.
- Notification authorization state lives in `~/Library/Preferences/com.apple.ncprefs.plist`
  (`apps` array, per-bundle-id `flags` bitmask); it can be read — and seeded —
  with `plutil`/`defaults` + `killall usernoted`.
- `macos-latest` is migrating to macOS 26 during June 15 – July 15, 2026:
  **all mac jobs pin `macos-15`.**
- `sqlite3` and `plutil` are preinstalled on runners; `tmux` is not
  (`brew install tmux`). PTY for TUI runs: `script -q /dev/null <cmd>` with
  `LANG=en_US.UTF-8`.
- Codex has an official `[hooks]` system: a `PermissionRequest` **Command hook**
  may print `{"hookSpecificOutput":{"hookEventName":"PermissionRequest",`
  `"decision":{"behavior":"allow"|"deny"}}}` and codex obeys it; empty output
  falls through to the interactive prompt; a crashed hook fails open.

## Design principle

**Never assert the sender's return code. Always assert state the OS or the
agent left behind:** an NC delivery record, a tmux `window_bell_flag`, a
sentinel file created (or provably not created) by a real agent run. Screenshots
are captured as artifacts for humans but never gated on (banner overlays don't
composite reliably in `screencapture` on runners).

## Architecture

### 1. Keystone: `src/platforms/macos-delivery.mjs`

Zero-dependency (Node `child_process`/`fs`/`os` + preinstalled `sqlite3` and
`plutil` CLIs). One module, two consumers: `aan doctor` locally, CI lanes in
automation. CI proving the product's own diagnostic is the point — the test
tooling is shipped user value.

```js
// All functions never throw; they return structured results.
ncDbPath()
// → string | null  — Sequoia path first, pre-Sequoia fallback, existence-checked.

notificationAuthState()
// → { state: 'authorized' | 'unauthorized' | 'unknown', app?: string, detail: string }
// Reads com.apple.ncprefs.plist (via plutil -convert json), finds the entry for
// the app that owns osascript notifications on this host, decodes its flags.
// 'unknown' when the plist or entry is unreadable — callers decide severity.

verifyDelivery(marker, { timeoutMs = 30000, pollMs = 1000 } = {})
// → { delivered: boolean, record?: { title, body, app, date }, reason?: string }
// Polls the NC DB read-only (sqlite3 'file:<path>?mode=ro', hex(data) on recent
// record rows), decodes each bplist BLOB (temp file + plutil -convert json),
// and matches `marker` as a substring of title or body. Returns the decoded
// record and owning app identifier on hit; { delivered:false, reason } on
// timeout or unreadable DB (reason distinguishes 'tcc-blocked' from 'timeout').
```

Exact SQL/joins (record ↔ app table) are finalized from the spike's dump of the
real macos-15 schema; the API above is fixed.

### 2. Product: `aan doctor`

`npx ai-agent-notifier doctor [--deep] [--json]` — new entry in the
`COMMANDS` map of `cli/index.mjs`, implemented in `cli/doctor.mjs` (UI) with
check logic importable by tests.

Per-channel checks, each reporting `ok | warn | fail` plus a one-line hint:

| Channel | Default checks | `--deep` adds |
|---|---|---|
| toast (macOS) | backend present (`osascript`); `notificationAuthState()` — unauthorized → warn with "send one toast, then enable it in System Settings → Notifications" hint | send a marker toast through the **real** `sendToast()`, then `verifyDelivery(marker)`; TCC-blocked DB → warn + exact Full-Disk-Access steps (graceful), `AAN_DOCTOR_STRICT=1` (CI) turns that warn into fail |
| toast (Windows) | BurntToast module present | fire toast + `Get-BTHistory` readback |
| toast (Linux) | `notify-send` present, D-Bus session reachable | fire + `dunstctl history` readback when dunst is the daemon |
| bell | tty writability (`/dev/tty`, tmux pane fallback); `TERM_PROGRAM` warning for known OSC/BEL swallowers (VS Code, Windsurf) | — |
| ntfy | config validity; server reachability (HEAD/GET health — **never publishes**) | — |
| webhook | config validity, URL parse; reachability HEAD — never posts a payload | — |
| config | file parses, unknown top-level keys warned | — |
| Focus/DND (macOS) | warn-only probe; `unknown` when unreadable — never a failure | — |

Behavior contract:

- Human output is a table; `--json` emits
  `{ platform, checks: [{ id, channel, status, detail, hint }] }` for CI.
- Exit code 0 when no check `fail`ed (warns allowed); 1 otherwise. The command
  itself never crashes mid-table (CLI strict at the edges, resilient inside).
- `--deep` deepens **local OS** checks only; it never sends to external
  services (ntfy/webhook stay dry-run).

### 3. CI lanes

All mac jobs: pinned `macos-15`, a shared preflight step (`sw_vers`,
`csrutil status` — must report disabled, else `[INFRA]` fail; resolve + stat
the NC DB path; FDA self-grant), and a diagnostics artifact uploaded with
`if: always()` (decoded recent DB rows, auth state, pane captures, screenshot).

| Lane | Workflow | Proves |
|---|---|---|
| **Live Toast macOS (delivery capture)** — new | `toast-macos.yml` + `scripts/live-toast-macos.mjs` | **Negative:** before authorization seeding, a real `osascript` notification produces **no** DB record and auth state reads unauthorized — pinning the silent-drop failure mode. (If the spike shows runners are pre-authorized, this test pivots to auth-state assertions; the spike decides.) **Positive:** seed authorization (ncprefs + `killall usernoted`) → real `sendToast()` with a unique marker → DB record exists with **exact title and body** and expected owning app. Then `doctor --deep --json` under `AAN_DOCTOR_STRICT=1` must agree — the product diagnostic proves itself in the same job. |
| **Live Toast Native** — shrunk | `toast-native.yml` | Windows-only (BurntToast). The macOS exit-code test it used to run is superseded by delivery capture. |
| **Live Claude E2E** — extended | `live-claude.yml` matrix += `macos-15` | Real `claude -p` run whose prompt embeds a nonce; Stop hook fires the product; assert **both** the ntfy push and the NC delivery record whose body carries the nonce (claude is the one source whose toast body is upgraded to the assistant's actual words — rich content, default ON, `src/notify.mjs`). |
| **Live Gemini E2E** — extended | `live-gemini.yml` matrix += `macos-15` | Same run shape with the real `gemini` CLI — but gemini notifications are generic (rich views are claude-only), so the NC assert matches the generic title/body plus a delivery date inside the run window (fresh runner = no ambiguity). |
| **Live Codex (approval loop)** — rewritten | `live-codex.yml`, ubuntu + `macos-15` | Finally launches real codex. Under an approval-requiring policy, codex asks permission for a shell command that creates a sentinel file. A `PermissionRequest` Command hook (test harness) does two things: fires the product's real approval notification, then returns the decision from `AAN_TEST_DECISION`. **allow** run → sentinel exists; **deny** run → sentinel absent and codex reports the denial. Mac leg additionally asserts the NC record for the approval notification (generic title/body + run-window date, as with gemini). The decision-returning is harness-only — the shipped product remains notify-only this pass. |
| **TUI Proofs (macos-15)** — new | `tui-proofs.yml` + committed harness under `scripts/tui/` | F1: real `claude` TUI inside tmux with terminal-bell enabled → after the turn, `tmux display -p '#{window_bell_flag}'` is `1`. F2: real `codex` TUI reaches an approval prompt → product notification fires → `tmux send-keys` approves → turn completes. Pane captures uploaded; one bounded retry per proof (INFRA flake budget), never around product asserts. |

Existing conventions carry over: paths-ignore for docs, concurrency groups,
SHA-pinned actions, skip-when-secret-missing still satisfies branch protection.

### 4. Spike before lanes

A scratch workflow on this branch (`spike-mac-delivery.yml`, `workflow_dispatch`
+ push-to-branch trigger, **deleted before merge**) answers, in one macos-15
dispatch:

1. Does the TCC.db FDA self-grant actually make the Sequoia Group-Containers DB
   readable on macos-15? (Fallback if not: macos-14 + pre-Sequoia path, viable
   until Nov 2026.)
2. Does unauthorized `osascript` really silent-drop on a fresh runner (no
   record), or are runners pre-authorized? (Decides the negative test's shape.)
3. Does an ncprefs seed + `killall usernoted` flip authorization so the
   positive path records? Also dumps the real `record`/`app` schema for the
   keystone's SQL.

Lane preflights inherit the spike's exact commands; its raw findings land in
the evidence record.

### 5. Failure taxonomy

Required-immediately gating makes red checks expensive, so every lane step
classifies its failure:

- `[INFRA]` — runner environment broke (csrutil unexpectedly enabled, DB
  unreadable after grant, brew/tmux setup failure, agent CLI install failure).
  Retried once where retry is meaningful.
- `[PRODUCT]` — the product failed the user (no record, wrong content, bell
  flag not set, sentinel state wrong). Never retried.

Both paths upload the full diagnostics bundle so a red required check is
diagnosable from the artifact in seconds. Delivery polls cap at 30s.

## Sound-name mapping (bug fix)

`src/platforms/macos.mjs` currently interpolates `toastSound` (Windows
SoundEvent names from default config) into `sound name "…"`. New mapping,
unit-tested:

| Input | macOS `sound name` |
|---|---|
| `Default` | omit the clause (system default sound) |
| `IM` | `Glass` |
| `Reminder` | `Ping` |
| `Mail` | `Purr` |
| `SMS` | `Tink` |
| `Alarm`/`Alarm2`–`Alarm10`, `Call`/`Call2`–`Call10` | `Sosumi` |
| already a valid macOS system sound (Basso, Blow, Bottle, Frog, Funk, Glass, Hero, Morse, Ping, Pop, Purr, Sosumi, Submarine, Tink) | pass through |
| anything else | omit the clause |

`README.md:188` ("ignored on macOS/Linux") is corrected to describe the mapping.

## Files changed

| File | Change |
|---|---|
| `src/platforms/macos-delivery.mjs` | **New.** Keystone verification module. |
| `src/platforms/macos.mjs` | Sound-name mapping; export the mapping fn for tests. |
| `cli/doctor.mjs` | **New.** `aan doctor` command. |
| `cli/index.mjs` | Register `doctor` in `COMMANDS` + help text. |
| `scripts/live-toast-macos.mjs` | **New.** Delivery-capture lane script (dunst-pattern port). |
| `scripts/tui/` | **New.** Committed tmux TUI harness (F1 bell, F2 codex approval). |
| `scripts/live-codex.mjs` | Rewritten for the real approval loop. |
| `.github/workflows/toast-macos.yml` | **New.** Delivery-capture lane. |
| `.github/workflows/toast-native.yml` | Shrink to Windows-only. |
| `.github/workflows/live-claude.yml` | Matrix += macos-15, nonce + NC assert. |
| `.github/workflows/live-gemini.yml` | Matrix += macos-15, nonce + NC assert. |
| `.github/workflows/live-codex.yml` | Rewritten: ubuntu + macos-15 approval loop. |
| `.github/workflows/tui-proofs.yml` | **New.** TUI proofs lane. |
| `tests/platforms.test.mjs` | Sound-mapping unit tests; macOS live test moves to the lane script. |
| `tests/macos-delivery.test.mjs` | **New.** Keystone unit tests (pure parts: path resolution, plist decode, flag decode on fixture data; live parts exercised by the lane). |
| `tests/doctor.test.mjs` | **New.** Doctor checks against real local state + `--json` contract. |
| `README.md` | :188 truth fix; per-channel × per-OS "what CI proves" matrix. |
| `docs/research/2026-07-11-macos-real-ux-evidence.md` | **New.** Evidence record (research reports + spike findings). |
| `package.json` | Version 1.2.0 (`aan doctor` is a user-facing feature). |

## Testing strategy

Repo philosophy holds: strict, real, no-mock, no-shotgun.

- Unit tests never mock `child_process`; pure helpers (sound mapping, bplist
  record decoding, ncprefs flag decoding) are tested on committed fixture data
  captured from the spike's real runner dumps.
- Live behavior is proven in lanes on real OSes with the real backends and real
  agents — the same code paths a user hits, asserted via OS-observable state.
- Negative tests are first-class: the silent-drop lane test pins the exact
  failure mode this design exists to catch.
- `doctor --deep` runs inside the delivery lane so the shipped diagnostic and
  the CI proof can never drift apart.

## Gating & rollout

1. Spike runs first on this branch; its findings finalize lane preflights and
   the keystone SQL; the scratch workflow is deleted before merge.
2. One PR from `feat/mac-real-ux` (one branch, one PR), all lanes green,
   including a full re-run to shake out flakes before review.
3. Immediately after merge: the new job names — Live Toast macOS (delivery
   capture), the macos-15 legs of Live Claude/Gemini E2E, Live Codex (approval
   loop), TUI Proofs (macos-15) — are added to branch-protection required
   checks (user decision: required from day one). Missing-secret skips satisfy
   protection, same as the existing paid lane.

## Non-goals (explicit)

- Banner-pixel/screenshot **gating** (artifacts only — overlays don't composite
  reliably on runners).
- Sound acoustics verification (no audio device on runners).
- Notification click-through / UI-scripting assertions.
- OSC-fallback product logic for swallowing terminals (doctor warns; product
  behavior unchanged this pass).
- Focus-aware escalation logic.
- Remote approval as a product feature (pass 4 — the codex lane's
  decision-returning hook is test harness, not product).
