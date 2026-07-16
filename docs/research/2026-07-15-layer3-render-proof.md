# Layer-3 render proof: proving notification text reaches the screen

Date: 2026-07-15 · Status: Linux lane shipped; macOS ceiling recorded

## Three layers of "the notification worked"

A desktop notification can be verified at increasing depth. Each layer is a
strictly stronger claim than the one before it:

1. **Layer 1 — the call returned.** `sendToast` resolved `true` / the backend
   exited 0. Proves we invoked the OS, not that the OS did anything. An exit-0
   check passes even when the notification is silently dropped.
2. **Layer 2 — the daemon recorded it.** The notification service accepted the
   exact title + body. On Linux we read it back out of `dunst`'s history; on
   macOS we read it out of Notification Center's own SQLite database. Proves the
   payload reached a real notification service — a silent drop records nothing
   and turns CI red.
3. **Layer 3 — pixels on a display.** The notification's text was legibly drawn
   on a screen and machine-read back off the framebuffer. This is the last
   millimetre before "a human's eyes saw it."

CI shipped layer 2 on both Linux and macOS. This note records where layer 3 is
achievable (Linux) and where it is not (hosted macOS), so no lane overclaims.

## macOS: layer 3 is NOT achievable on hosted CI (ceiling = layer 2)

A throwaway spike on the `macos-15` hosted runner (Actions run **29384991828**)
fired the real `osascript` notification and tried, three ways, to prove a banner
drew on screen:

- **Records but never presents.** The fire reliably recorded in the Notification
  Center DB (layer 2), but no banner window ever appeared — capture frames stayed
  bare and `CGWindowList` enumerated zero `NotificationCenter`/`usernoted`
  windows over the banner's whole lifetime.
- **Accessibility tree is walled off.** `System Events` → `NotificationCenter`
  window reads returned AppleEvents error **-1728** (not permitted) — the AX
  route is blocked by TCC on the runner.
- **Screen capture trips a consent nag.** Repeated `screencapture` invocations
  trip a Sequoia screen-recording consent prompt; `CGWindowList` was the only
  TCC-light enumeration that worked, and it saw nothing.

Distinguishing "a fixable presentation setting" from "the headless session never
presents banners" would require forcing presentation *and* clearing the
screen-recording consent wall — compounding TCC risk for uncertain payoff, since
a forced presentation may not mirror a real user's Mac anyway.

**Conclusion:** on hosted macOS CI, notifications are provable to **layer 2**
(the shipped Toast macOS lane), not layer 3. On-screen rendering is a real-user-Mac
concern, checked there by `aan doctor --deep` (presentation + permission state).

## Linux: layer 3 IS achievable (shipped)

Linux is the one surface where we own the whole session — Xvfb gives a real X
display with no TCC equivalent, and `dunst` is a real `org.freedesktop.Notifications`
daemon we can configure. A spike (Actions run **29391999880**, `ubuntu-latest`)
proved the pixel read-back end to end:

- Start `dunst` under a **project-owned dunstrc** tuned for OCR: DejaVu Sans Mono
  26, white-on-black, wide banner, no timeout.
- Fire the **real** `src/platforms/linux.mjs` → `notify-send` path with an
  OCR-safe nonce in the body.
- Capture the X root window with ImageMagick `import -window root` (fallback
  `xwd | convert`) and OCR each frame with `tesseract --psm 6`.
- **No-false-positive guard:** the pre-fire frame's OCR must not contain the
  nonce. **Positive gate:** a during-display frame's OCR must contain it
  (normalized, whitespace-stripped substring — never full-string equality,
  because the icon glyph decodes to a stray leading character).

Result: the nonce was legible in **6 of 6** during-display frames and absent from
the pre-fire frame. The rendered banner PNG was inspected by a human.

### What the shipped Linux lane claims (and no more)

`scripts/live-toast-linux-render.mjs` runs in the **Toast Linux** workflow as a
hard-failing step after the layer-2 history assert. Because rendering uses **our**
dunstrc on a **virtual** (Xvfb) display, the claim is precisely: *the product path
draws legible, machine-readable pixels* — not that every user's desktop theme
renders identically.

### Gotchas (for anyone touching this lane)

- `linux.sendToast` maps `notification.priority` through `URGENCY_MAP`; it does
  **not** read a `urgency` field. Fire with `priority`.
- Nonce alphabet is **observed-correct glyphs only** (`scripts/lib/ocr-nonce.mjs`):
  `ACDEGHMNPRTUVWY3467` — exactly the characters captured OCR-reading-back-correctly
  across the three real renders (`GADNNM36RW`, `U*NRP7MY4E`, `7CNHVTVE3G`). A
  static banner renders identical pixels every frame, so an OCR misread is
  **systematic** — it repeats on every frame and the multi-frame retry cannot
  rescue it. So a glyph may gate a required check only once a capture proves it
  reads back. Excluded for two reasons: known-confusable and banned outright
  (`0 O 1 I L 5 S 8 B 2 Z 9` — the `9` earned its place when run `29394142374`
  read a rendered `9` as `S`, failing the gate), and not-yet-observed (`F J K Q X`,
  held out until a capture proves them — `Q`/`O` is a classic confusable and `O`
  is already banned). This is the measure-flake-before-gating step the design's
  honesty rail calls for.
- Match with a normalized `.includes(nonce)`, never full-string equality: OCR
  inserts stray whitespace and the notification icon adds a stray leading char.
- `dunst` logs a benign `CRITICAL: Cannot acquire org.freedesktop.Notifications`
  as the transient dbus-autolaunch instance loses the bus name to the real dunst.
  Not a failure — delivery still works.
- All `ubuntu` jobs on a push can queue for tens of minutes behind an
  account-wide runner concurrency cap while macOS jobs drain; that latency is not
  a lane failure.

## Windows (2026-07-16): layer 2 achievable, layer 3 is not (ceiling = layer 2)

A throwaway spike on `windows-latest` (Actions run **29474327064**, Windows Server
2025, build 10.0.26100) fired the REAL product path (`src/platforms/windows.mjs` →
`assets/windows/toast.ps1` → BurntToast `Submit-BTNotification`) with a nonce in
the title and body, then read the notification back out of the Windows push-
notification platform store, `%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db`.

**Verdict: YES to layer 2.** The toast was recorded as a `Notification` row of
`Type=toast` whose `Payload` (toast XML) carried the exact nonce in both `<text>`
elements (`Claude Code <nonce>` / `<nonce>: Needs your input`). The pre-fire
no-false-positive guard was clean (DB present, nonce absent). This is now the
shipped **Toast Native** layer-2 gate (`scripts/live-toast-windows.mjs` +
`scripts/lib/wpn-readback.py`).

Findings and traps (each: symptom → cause → fix):

- **WAL trap — false negative (same class as the macOS `immutable=1` bug).** In one
  post-fire read, a copy-with-WAL open and a plain `mode=ro` open both found the
  nonce (4284 rows), while `mode=ro&immutable=1` saw only 4080 rows and **0 hits** —
  the freshly fired notification lived entirely in the `-wal` sidecar, which
  `immutable=1` skips. The reader is WAL-aware on purpose: copy `db` + `-wal` + `-shm`
  to temp and open the copy (primary), or `mode=ro` without immutable (fallback);
  **never** `immutable=1`.
- **BurntToast is a prerequisite, not a default.** `Import-Module BurntToast` throws
  on a bare runner → the product ps1 hits its catch and `exit 3`, recording nothing.
  CI installs it first (`Install-Module BurntToast -Force -Scope CurrentUser`); a real
  user's setup does the same.
- **Recording identity (AUMID).** The toast records under
  `Microsoft.AutoGenerated.{GUID}`, `HandlerType=app:desktop`, `WNSId=NonImmersivePackage` —
  BurntToast's auto-generated non-packaged desktop AppId. No Start-menu shortcut or
  manual AUMID registration is needed on the runner.
- **Bonus: click-to-focus survives the round trip.** The recorded XML preserved the
  product's `launch="agentfocus://<nonce>/?hwnd=…&cwd=…"` protocol activation, so the
  store confirms not just the text but the click-to-focus wiring.
- **Layer 3 is NOT achievable.** The hosted runner is a headless Session-0 environment
  with no interactive desktop, so — exactly like macOS — the toast is recorded but no
  banner is presented. On-screen rendering is a real-machine concern, checked by
  `aan doctor` (PowerShell + BurntToast + execution-policy state).

The `aan doctor` win32 backend check, previously a hardcoded `ok`, now really probes:
PowerShell present, BurntToast module resolvable, and no policy-scope execution policy
(MachinePolicy/UserPolicy = Restricted|AllSigned) that would override the product's
`-ExecutionPolicy Bypass`.

## References

- macOS spike: Actions run `29384991828` (records to NC, no banner, AX -1728).
- Linux spike: Actions run `29391999880` (6/6 OCR frames, human-inspected).
- Windows spike: Actions run `29474327064` (records to wpndatabase.db, nonce in
  title + body, WAL-only row, no banner on Session-0 runner).
- Design: `docs/specs/2026-07-15-linux-render-proof-design.md`.
