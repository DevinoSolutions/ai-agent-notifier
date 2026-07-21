# Changelog

All notable changes to `anotifier` are documented here. This project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [1.2.2] — 2026-07-20

Release-infrastructure only — **no functional or behavioral changes from 1.2.1**;
the package contents are identical.

### Changed
- **First release published via tokenless CI with provenance.** 1.2.1 was
  published manually to bootstrap the new `anotifier` package name — npm requires
  a package to exist before a Trusted Publisher can be configured — so it carries
  no build provenance. 1.2.2 is the first release cut through GitHub Actions using
  npm Trusted Publishing (OIDC), so the published artifact now ships with a
  verifiable provenance attestation, and no npm token is involved at any point.

## [1.2.1] — 2026-07-16

**First release published to npm since 1.0.6.** Everything in 1.1.0 and 1.2.0
below ships to npm users for the first time with this release.

### Renamed
- The package is now **`anotifier`** (was `ai-agent-notifier`), the CLI command
  is now **`anotifier`**, the config directory is now **`~/.anotifier`** (was
  `~/.ai-agent-notifier`), and the project home is **https://anotifier.io**. The
  repository was renamed to `anotifier-for-claude-codex-cursor`.
- **Upgrading from `ai-agent-notifier`?** Re-run setup — `npx anotifier@latest
  setup` — because the command name and config directory changed. Prior config
  is not auto-migrated; the old `ai-agent-notifier` package is deprecated and
  points here.

### Fixed
- **Linux toasts silently dropped for messages starting with `-`.** `notify-send`
  was invoked positionals-first with no `--` end-of-options guard, so rich
  content beginning with a dash (e.g. an assistant line like `- Fixed the bug`)
  was parsed as an unknown option and the toast never fired. Arguments are now
  options, then `--`, then title/message.
- **`anotifier test ntfy` crashed on a scheme-less server value.** An unguarded
  `new URL()` broke the ntfy sender's resolve-false/never-throw contract; a typo
  like `ntfy.sh` (no `https://`) now degrades cleanly instead of throwing.
- **Update-check nagged a downgrade.** The version comparison used string
  inequality, so a user on 1.2.x was told to "update" to the older npm `latest`.
  It now uses a proper semver comparison.
- **`npm test` never ran on Windows with Node 18/20.** Test globs are expanded
  by the runner itself rather than relying on shell globbing.

### Added
- **Real install one-liners.** `setup/install.sh` and `setup/install.ps1` now
  exist — the README `curl | bash` / `irm | iex` commands previously 404'd and
  silently no-opped. Both preflight Node ≥ 18 + npm, fail loudly, and hand off
  to `npx anotifier@latest setup`.
- **`anotifier doctor --deep` verifies delivery on Linux.** Fires the real toast with
  a unique marker and reads it back out of `dunst`'s own history, degrading
  honestly (dispatched-but-unverified) when no reader daemon is present. The
  win32 backend check is now a real probe (PowerShell + BurntToast + execution
  policy) instead of a hardcoded `ok`.
- **Release pipeline.** Pushing a `v*` tag runs a 3-OS × Node 18/20/22 matrix,
  verifies tag/`package.json`/plugin-manifest lockstep and the `npm pack`
  payload, then publishes with `--provenance` and drafts a GitHub release. CI
  never tags or publishes on its own — the maintainer cuts the tag.

### Changed
- **Honest documentation.** Removed a README claim of a macOS `terminal-notifier`
  fallback that never existed in code; scoped the WSL claims to the
  detection/interop behavior that is actually tested.
- **CI de-duplicated.** Push and pull-request runs no longer double-fire; push
  triggers are restricted to `main`.
- **Hardened live-push assertions.** The live E2E lanes now always log the
  received push and hard-assert the deterministic router body, closing an
  observability gap.

## [1.2.0] — 2026-07-16 — Real-delivery verification

Notifications can fail **silently** — `osascript`/`notify-send`/BurntToast all
exit `0` even when nothing renders. This line replaces "the command exited 0"
with proof of the real user experience, so CI goes red when a real user would
have seen nothing.

### Added
- **macOS:** a fired notification is read back out of Notification Center's own
  SQLite database and matched to the exact payload (layer 2 — OS store recorded).
- **Linux:** layer-3 render proof — the notification text is OCR-verified as
  legible pixels on a real X display, not just recorded by the daemon.
- **Windows:** layer-2 proof — the toast is read back out of `wpndatabase.db`
  with the exact nonce in its title and body, promoting the lane from exit-0.

## [1.1.0] — 2026-07-10

Five features selected from a verified user-demand research pass, plus a second
audit pass hardening observability and the CLI.

### Added
- **Terminal bell channel** via `terminalSequence` — the hook reply carries a
  bell that Claude Code (≥ 2.1.141) rings through its own terminal write path,
  fixing the silent `/dev/tty` failure after hooks lost their TTY.
- **Codex approval alerts** — registers the `PermissionRequest` hook event so
  Codex approval prompts raise a notification.
- **Transcript-derived rich content** — toasts and webhooks can show the
  assistant's actual question or last message (bounded, sanitized). ntfy stays
  generic by default, since public ntfy.sh topics are guessable — rich content
  there is opt-in.
- **WSL toast delivery** — notifications from inside WSL surface on the Windows
  host.
- **Webhook channel** — deliver notifications to an arbitrary HTTP endpoint.

### Changed
- Every hook failure now lands in a bounded `errors.log` (surfaced by `status`,
  optionally mirrored to Sentry via a zero-dependency client), config keys
  renamed to what they mean with validation and migration hints, SHA-pinned CI
  actions, and a ~50× smaller npm package.

## [1.0.6] — 2026-06-19

Previous release published to npm. Baseline for the changes above.
