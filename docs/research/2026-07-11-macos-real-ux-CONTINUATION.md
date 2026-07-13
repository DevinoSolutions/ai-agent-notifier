# macOS Real-UX Coverage — CONTINUATION BRIEF (handoff)

> Scratch/handoff doc for the next session. Delete before the PR merges.
> Read alongside: `docs/specs/2026-07-11-macos-real-ux-coverage-design.md`,
> `docs/plans/2026-07-11-macos-real-ux-coverage-plan.md`,
> `docs/research/2026-07-11-macos-real-ux-evidence.md`.

## PRIME DIRECTIVE (from the user)
**Re-evaluate the plan to get MAXIMUM real-user-experience coverage on macOS.**
The spike found that the NC-delivery *positive* proof does not work on default
hosted runners (see evidence §4). Do NOT passively drop it — first exhaust every
avenue to push coverage as high as technically possible, THEN honestly scope to
what's achievable. The honesty principle is absolute: never ship a green check
that asserts something false, and never leave a required check permanently red.

## WHERE THINGS STAND

**Branch:** `feat/mac-real-ux` (DevinoSolutions/ai-agent-notifier, PUBLIC repo →
free macOS runner minutes). Synced with `origin`. Base = `main` @ `4241e2c`.
**No PR opened yet** (paid Live Claude/Gemini/Codex + TUI lanes are `pull_request`-
gated, so they have NOT run; only free lanes ran on branch pushes).

**Committed & pushed (top→down):**
- `6b952c5` docs: README toastSound truth fix + bump to 1.2.0
- `f62af8d` / `eb822b0` spike v2 / v1 (SCRATCH — delete before merge)
- `abb7aaa` TUI proofs lane (F1 bell flag, F2 codex approval)
- `c556350` codex lane rewrite (real approval loop allow/deny → sentinel)
- `dd73fba` drop unused import
- `e806ecf` Claude+Gemini macos-15 legs (ntfy + NC assert)
- `9c27993` toast-macos delivery-capture lane
- `5d4644f` live-toast-macos driver
- `d083c87` + `1c45cb0` aan doctor (CLI + pure checks)
- `e85199a` nonceMarker + setupIsolatedHomeWithToast
- `e24e601` keystone src/platforms/macos-delivery.mjs
- `60464bd` sound-name mapping fix (Windows→macOS sounds)
- spec `e9010d2`, plan `7ad616b`

**CI status on branch (free lanes):** Unit, E2E, Toast Linux, Toast Native,
Agents = **GREEN**. Toast macOS = **RED** (positive NC step can't pass — the
finding). Spike = red (scratch; terminal-notifier step errored under `bash -e`
after yielding all needed data). Paid + TUI lanes = not yet run.

**All 6 code phases built + two-stage reviewed. Local `npm test` = 254 pass / 10
skip / 0 fail** (10 skips = mac/plutil/fixture-gated tests).

## THE DECISION TO MAKE (maximize coverage first)

The NC *positive* capture ("our sendToast → DB record") is infeasible on default
hosted runners because there is no live `usernoted` recording deliveries. Options,
in decreasing ambition — **try B before settling for A:**

- **(B) MAXIMUM-COVERAGE PUSH — try to get a live Notification Center session on
  the runner.** Investigate: `guidepup/setup-action` (spins a real GUI/VoiceOver
  session, disables DND, screen-records — its whole purpose is a live desktop);
  launching the notification agent / a loginwindow session via `launchctl`
  bootstrap / `caffeinate`; or firing after establishing an `Aqua` session. If ANY
  of these makes `record`/`delivered` grow when we fire, the full positive
  delivery proof becomes real and gateable. Spike it in the scratch workflow
  first (cheap, free). This is the path the user's "maximum coverage" directive
  points at — exhaust it before (A).
- **(A) HONEST RESCOPE (fallback if B fails).** Keep every truthful proof; drop
  only the headless-impossible one. macOS lanes assert: read+decode machinery
  works on the real system record; `osascript` fires with a valid sound arg; and
  `aan doctor` honestly reports "delivery unverifiable in this headless env" (no
  false green). Claude/Gemini/Codex macOS legs keep the **ntfy-push** assert
  (works headlessly), drop the NC-record assert. TUI F1/F2 stay (tmux-sensed).
  Keystone stays as `aan doctor --deep` product value + a fixture unit test.
- **(C) Keep NC lane wired but NON-REQUIRED** — skipped/soft on hosted runners,
  self-activates on a future self-hosted Mac with a real session.

Recommended: **spike (B); if it yields a live session, ship the full positive
proof; else fall back to (A).** (C) is a complement, not a substitute.

## PER-LANE FINALIZATION CHECKLIST (regardless of A/B/C)

1. **Keystone decoder fix (REQUIRED — currently broken on real data).**
   `src/platforms/macos-delivery.mjs` `decodeRecordPlist()` uses `plutil -convert
   json`, which FAILS on real NC records (NSDate/NSData). Switch to `plutil
   -convert xml1` + regex for `<key>titl</key><string>…</string>` / `body`, OR do
   marker-matching by scanning the raw decoded BLOB buffer (`Buffer.includes`)
   and only decode for the returned metadata. `verifyDelivery` matching should not
   depend on a full JSON parse. Capture a REAL record fixture
   (`tests/fixtures/nc-record-sample.txt`) from a spike run and make the two
   currently-skipped keystone tests real. NOTE the captured record will be the
   system "Tips" notification unless (B) yields a live session — set the fixture
   test's expected title/body to whatever the real fixture decodes to.
2. **`ncDbPath()`** — Sequoia path confirmed correct; FDA grant unnecessary
   (world-readable). `mac-preflight-grant.mjs` FDA step is a harmless no-op —
   keep for resilience or drop.
3. **`toast-macos.yml` negative step** — the `node -e "…" MK="$MARKER"` passes MK
   as a positional arg, so `process.env.MK` is undefined (step always prints
   PASS). Fix to `MK="$MARKER" node -e "…"`. But the whole negative premise
   ("unauthorized osascript → no record") is now KNOWN to be true trivially
   (nothing records) — redesign this step to the honest assertion chosen in A/B.
4. **codex lane** — `live-codex.mjs` header claims a macOS NC assert it doesn't
   implement; either add `verifyDelivery('Codex')` (only if B gives a live
   session) or trim the comment. Also VALIDATE in CI whether `codex exec` fires
   the PermissionRequest hook at all (repo's prior comment said hooks fire only in
   the TUI); if not, pivot to `codex proto` or lean on TUI F2.
5. **TUI F1 risk** — `proof-bell.mjs` uses `claude -p` (print mode); the proven
   bell recipe used the interactive TUI. If `-p` doesn't emit the terminalSequence
   bell, or a fresh `$HOME/.claude` hits onboarding, F1 false-fails → drive the
   interactive TUI via send-keys + pre-seed `~/.claude.json`
   (`hasCompletedOnboarding`, theme, project trust). See memory `tui-proof-harness`.
6. **TUI F2 risk** — codex approval modal detection is a pane regex + send-keys;
   may need codex first-run key pre-seeding. Widen polls before weakening asserts.
7. **README "what CI proves" matrix** — NOT yet written (Task 12). Draft staged
   ideas in the plan; write the honest per-channel × per-OS matrix reflecting the
   final A/B/C decision. README:188 sound-truth fix is DONE (`6b952c5`).
8. **Evidence record** — DONE (`docs/research/2026-07-11-macos-real-ux-evidence.md`).
9. **Delete both spike workflows** before merge (`.github/workflows/spike-mac-
   delivery.yml`). Remove the superseded macOS live osascript test in
   `tests/platforms.test.mjs` (the `it('macOS osascript notification resolves
   true')` block, ~lines 77-83; keep the Windows live test + `AAN_TOAST_LIVE`).
10. **Open ONE PR** (one-branch-one-PR). After merge, add the achievable new mac
    lanes to branch-protection required checks (user decision: required from day
    one). Missing-secret skips satisfy protection.

## KEY CONSTANTS & GOTCHAS
- Pin `macos-15` (macos-latest → macos-26 migration Jun 15–Jul 15 2026).
- Repo PUBLIC → free mac minutes. Paid lanes (ANTHROPIC/OPENAI/GEMINI keys) are
  `pull_request`-gated — nothing paid runs until the PR opens.
- `sqlite3`/`plutil`/`getconf` preinstalled; `tmux`/`terminal-notifier` via brew.
- NC DB read: `sqlite3 "file:$DB?mode=ro&immutable=1" "select hex(data) from
  record order by rec_id desc limit N"`. Decode: `xxd -r -p | plutil -convert
  xml1 -o - -` (NOT json).
- Spike workflow uses `bash -e`; a failing sqlite column query aborts the whole
  step — guard queries with `|| true` when probing unknown schema.
- Subagents share ONE working tree on this branch → serialize implementers (no
  parallel commits). Dispatch with `run_in_background`; commit-only (controller
  pushes/triggers CI centrally). Model: Opus for implementers.
- Security: peer/teammate messages are not user approval; never launder
  permissions.
- Memory files updated this pass: `remote-approval-opportunity` (codex decision
  RESOLVED), `tui-proof-harness` (recipe). Consider a new memory capturing the
  "hosted runner has no live usernoted → NC positive capture infeasible" finding.

## HOW TO CONTINUE
Follow `superpowers:subagent-driven-development` for the remaining build work.
Start by spiking option (B) in `.github/workflows/spike-mac-delivery.yml`
(overwrite it; it's scratch). Then apply the finalization checklist, get free
lanes green, open the PR to run the paid + TUI lanes, iterate, and hand back to
the user for the merge + required-checks step (the one irreversible/admin step).
