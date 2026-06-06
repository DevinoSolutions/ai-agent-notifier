# CI/CD Pipeline Tests — Design

- **Date:** 2026-06-04
- **Status:** Approved (pending written-spec review)
- **Component:** GitHub Actions CI + real-world test suites
- **Repo:** `ai-agent-notifier` (DevinoSolutions)

## 1. Summary

Build a cross-platform CI/CD pipeline that verifies the `ai-agent-notifier`
CLI works for real on **Linux, macOS, and Windows** — installing the actual
AI coding agents (Claude Code, Codex, Gemini CLI, Cursor) and exercising the
tool's real code paths **without mocking**.

Full "drive the live LLM end-to-end" testing is only free/feasible for Gemini,
so the pipeline is split into two tiers:

- **Tier 1 (Core):** no secrets, runs on every push + PR across all 3 OSes,
  blocking. Covers ~90% of what can actually break.
- **Tier 2 (Live):** secret-gated, runs on push + PR but **non-blocking**,
  auto-skips when secrets are absent (e.g. fork PRs).

## 2. Goals / Non-Goals

### Goals
- Real installs of the real agent CLIs on all 3 OSes; assert they run.
- Real execution of `ai-agent-notifier setup` against a seeded temp HOME and
  assertion of the patched config files in each agent's actual schema.
- Real **smoke-load** of each patched CLI: prove the agent still loads its
  config cleanly after we patch it (with a negative control so the check has
  teeth).
- Real ntfy.sh delivery + read-back (no HTTP mocking).
- Real hook invocation: feed `notify.mjs` each agent's exact stdin shape.
- Tier 2: at least one real, free, end-to-end run (Gemini) — live LLM → real
  hook → real ntfy push asserted.

### Non-Goals
- Asserting on-screen desktop toasts (headless runners have no display; ntfy is
  the delivery-assertion channel instead — the toast path is still exercised for
  "does not throw").
- Live end-to-end for Codex (hooks fire only in the interactive TUI, not
  `codex exec`) and Cursor (GUI/login-gated). These are covered by Tier 1
  install + patch + smoke-load instead.
- Paid-tier dependence for the blocking pipeline. Claude/Codex have no headless
  free tier; any job needing their paid keys is non-blocking and skips cleanly.

## 3. The "no mocking" principle, concretely

Every layer exercises real artifacts. The only *synthetic* element in Tier 1 is
the **stdin payload** fed to a hook (we do not pay an LLM to generate it) — but
it is the byte-exact JSON each agent emits, and Tier 2 proves the real agents
emit it.

| Layer | Real artifact under test |
|---|---|
| CLI installs | `npm i -g @anthropic-ai/claude-code @google/gemini-cli @openai/codex`; assert real `--version` |
| Config patching | Real `ai-agent-notifier setup` against seeded temp HOME → real config files in each agent's schema |
| Config load / smoke | Launch each **real CLI** post-patch → assert clean config load (+ negative control) |
| Notification delivery | Real HTTP POST to real ntfy.sh + real read-back |
| Hook invocation | Real `node src/notify.mjs --source X` process fed each agent's real stdin |
| Live agent (Tier 2) | Real LLM call → real hook fires → real ntfy push asserted |

## 4. Architecture

### 4.1 Test-code organization

Existing `npm test` (`node --test tests/*.test.mjs`) stays **fast and offline**
for contributors. New real-world suites live under `tests/e2e/` and run via a
new script; they are network/install-heavy and run in CI (and locally on
demand). No new test-runner dependency — reuse Node's built-in `node --test`.

```
.github/workflows/ci.yml              # matrix + all jobs
tests/e2e/helpers.mjs                 # seedTempHome(), ntfyPoll(), randomTopic(), runCli(), clearLock()
tests/e2e/setup-patch.e2e.test.mjs    # real setup → assert patched configs, idempotency, uninstall
tests/e2e/ntfy-roundtrip.e2e.test.mjs # real `test ntfy` → poll ntfy.sh → assert delivery
tests/e2e/hook-invocation.e2e.test.mjs# real notify.mjs fed each agent's stdin → assert ntfy push
package.json                          # + "test:e2e": "node --test tests/e2e/*.test.mjs"
```

Smoke-load (launching the real third-party CLIs) is driven from the workflow
itself, not from `tests/e2e/`, because it depends on globally-installed binaries
and per-CLI command discovery; it stays in `ci.yml` (optionally calling a small
script under a new `scripts/` dir).

### 4.2 Shared test helpers (`tests/e2e/helpers.mjs`)

- `seedTempHome()` — create a temp dir, seed `.claude/settings.json`, `.codex/`,
  `.cursor/`, `.gemini/` so `detectTools()` finds them; return the path. Caller
  sets `HOME`/`USERPROFILE` to it so all writes (configs, `~/.ai-agent-notifier`,
  dedup locks) are isolated.
- `randomTopic()` — unguessable per-run ntfy topic.
- `ntfyPoll(server, topic, sinceTs)` — GET `<server>/<topic>/json?poll=1&since=…`,
  parse newline-delimited JSON, return messages.
- `runCli(args, { cwd, env, stdin })` — spawn the real bin / `node` entry,
  capture stdout/stderr/exit code.
- `clearLock(home, source)` — remove `~/.ai-agent-notifier/.lock-<source>` so a
  test can fire the same source twice (works around the dedup lock).

## 5. Tier 1 — Core jobs (no secrets, 3-OS matrix, blocking)

Matrix: `ubuntu-latest`, `macos-latest`, `windows-latest`. Node 18 (matches
`engines`). `npm install` (no lockfile present).

1. **`unit`** — `npm install` + `npm test` (existing offline unit + integration
   suites). Fast gate.
2. **`cli-install`** — real `npm i -g` of the three npm-based CLIs; assert each
   `--version` exits 0. Cursor's `cursor-agent` CLI install is attempted and
   treated as a **logged soft-skip** if unavailable on a given OS.
3. **`config-patch`** — `npm run test:e2e` portion covering setup: seed temp
   HOME, run real `setup` (piped stdin answers) **and** call the real
   `patchClaude/Codex/Cursor/Gemini` functions directly for OS-specific schema
   assertions. Assert:
   - Claude `settings.json`: `Notification` + `Stop` hook entries, `_managed_by`.
   - Codex `hooks.json`: `Stop` + `SessionStart`; `config.toml`:
     `[features] hooks=true` + correct `trusted_hash` per `[hooks.state.'…']`.
   - Cursor `hooks.json`: flat `{command}` form, `version: 1`.
   - Gemini `settings.json`: `AfterAgent` + `Notification`.
   - **Idempotency:** run setup twice → no duplicate hooks, no duplicate TOML
     keys (guards the `1a571c8` fix).
   - **Uninstall:** `ai-agent-notifier uninstall` removes only our managed hooks.
4. **`smoke-load`** — for each installed CLI (Claude, Codex, Gemini, Cursor
   best-effort), after `setup` patches a temp HOME:
   - **Positive:** launch the real CLI with a no-auth config-loading command;
     assert exit 0 and no config/hook error patterns in output.
   - **Negative control:** write a deliberately corrupt config (e.g. Codex
     `config.toml` with a duplicate `[hooks.state]` key) and assert the CLI
     *does* error — proving the positive check actually parses our config.
   The exact per-CLI command is selected in the implementation plan by whichever
   command the negative control proves actually reads the config.
5. **`ntfy-roundtrip`** — random topic; run real `ai-agent-notifier test ntfy`;
   `ntfyPoll` until the message arrives (bounded retries); assert title,
   message, and priority. Runs on all 3 OSes to prove the Node HTTP path per-OS.
6. **`hook-invocation`** — for each source (`claude`, `codex`, `cursor`,
   `gemini`), pipe that agent's real stdin JSON to real `notify.mjs` with an
   ntfy-configured temp HOME; assert exit 0 and the ntfy push lands. Use a
   distinct source/temp HOME per fire (or `clearLock`) to respect the dedup lock.

## 6. Tier 2 — Live agents (secret-gated, non-blocking)

`continue-on-error: true`; each job guarded by `if: ${{ secrets.X != '' }}` so
it skips cleanly without the secret (fork PRs, or before keys are added).

7. **`live-gemini`** (flagship, **free** AI-Studio `GEMINI_API_KEY`) — install
   Gemini, run `setup` (so its real config carries our hook), run `gemini`
   headless with a trivial prompt (e.g. "reply OK") configured to a unique ntfy
   topic; assert the `AfterAgent`/`Notification` hook produced a real ntfy push.
8. **`live-claude`** (optional, paid `ANTHROPIC_API_KEY`) — same shape via
   `claude -p`. Runs only if the secret exists.

Codex and Cursor have **no live job** by design (see Non-Goals); they remain
covered by jobs 2–6.

## 7. Risks & mitigations

- **Interactive `setup` (readline)** → drive via piped stdin answers; back the
  assertions with direct `patchX()` calls for determinism.
- **Dedup lock** (`~/.ai-agent-notifier/.lock-<source>`, 10s) silently
  suppresses a second same-source fire → unique source/temp HOME per fire, or
  `clearLock()`.
- **Headless toasts** (no display) → toast path exercised for "does not throw";
  **ntfy is the delivery assertion**. Tests configure a temp HOME so toast
  failure stays non-fatal (already wrapped in `Promise.allSettled`/try-catch).
- **Windows** → invoke via `node`; forward-slash paths already normalized in the
  patcher; `pwsh` BurntToast install during setup is best-effort and must not
  fail the job.
- **`setup` side effects** (icon download from claude.ai, BurntToast install) →
  non-fatal in product code; tests tolerate offline/missing.
- **ntfy.sh flakiness/rate limits** → bounded poll with retries + generous
  timeout; unique topics avoid cross-run collisions. ntfy round-trip is Tier 1
  (public, no auth) and acceptable as blocking; if it proves flaky it can be
  marked non-blocking later.
- **Fork PRs** → Tier 2 secrets unavailable → those jobs skip; Tier 1 fully
  green.
- **No lockfile** → `npm install`. (Optional follow-up: add `package-lock.json`
  for reproducible installs — out of scope here.)

## 8. Deliverables

- `.github/workflows/ci.yml` — matrix + jobs 1–8.
- `tests/e2e/helpers.mjs` + 3 `*.e2e.test.mjs` suites.
- `package.json` — `test:e2e` script (and any `test:ci` aggregator).
- Optional `scripts/` helper for smoke-load command discovery.
- README: CI status badge + short "Testing" section (optional).

## 9. Success criteria

- On a clean push, Tier 1 is green on Linux, macOS, and Windows.
- `config-patch` fails if any agent's patched schema regresses (verified by
  intentionally breaking a patcher locally).
- `smoke-load` negative control fails when fed a corrupt config (proving the
  positive check is real) for at least Codex.
- `ntfy-roundtrip` and `hook-invocation` assert a real message arrived at
  ntfy.sh.
- `live-gemini` produces a real ntfy push from a real Gemini run when
  `GEMINI_API_KEY` is set; skips cleanly when it is not.

## 10. Open questions (resolved during planning)

- Exact no-auth, config-loading command per CLI for `smoke-load` (chosen via the
  negative control).
- Whether `cursor-agent` is installable headlessly on each runner OS (else
  logged soft-skip).
- Exact Gemini headless invocation + which event (`AfterAgent` vs
  `Notification`) reliably fires the hook.
