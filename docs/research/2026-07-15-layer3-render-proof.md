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

## References

- macOS spike: Actions run `29384991828` (records to NC, no banner, AX -1728).
- Linux spike: Actions run `29391999880` (6/6 OCR frames, human-inspected).
- Design: `docs/specs/2026-07-15-linux-render-proof-design.md`.
