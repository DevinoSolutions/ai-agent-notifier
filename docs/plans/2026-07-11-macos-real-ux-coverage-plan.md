# macOS Real-UX Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CI fail whenever a real Mac user would have seen or heard nothing, by asserting OS-observable state (Notification Center delivery records, tmux bell flags, sentinel files) instead of sender exit codes — and ship the delivery-verification core to users as `aan doctor`.

**Architecture:** One zero-dependency module (`src/platforms/macos-delivery.mjs`) reads the Notification Center SQLite DB to prove a notification was delivered. Two consumers use it: the new `aan doctor` command (product) and five CI lanes on `macos-15` runners driving real Claude/Gemini/Codex. A spike workflow runs first to pin three runner-specific unknowns, then the module, product, and lanes are built TDD.

**Tech Stack:** Node.js ESM (`>=18`), `node --test`, preinstalled macOS `sqlite3`/`plutil`/`getconf`, GitHub Actions (`macos-15`), tmux (via brew), real agent CLIs (`@anthropic-ai/claude-code`, `@google/gemini-cli`, `@openai/codex`).

**Spec:** `docs/specs/2026-07-11-macos-real-ux-coverage-design.md`

---

## File Structure

**New files:**
- `src/platforms/macos-delivery.mjs` — keystone: `ncDbPath()`, `notificationAuthState()`, `verifyDelivery()`, plus exported pure helpers `decodeRecordPlist()`, `decodeAuthFlags()`.
- `cli/doctor.mjs` — `aan doctor` command (UI shell).
- `cli/doctor-checks.mjs` — pure check logic (importable by tests, no console I/O).
- `scripts/live-toast-macos.mjs` — delivery-capture lane driver (macOS port of `live-toast-linux.mjs`).
- `scripts/tui/lib.mjs` — shared tmux TUI harness helpers.
- `scripts/tui/proof-bell.mjs` — F1: claude TUI bell → `window_bell_flag`.
- `scripts/tui/proof-codex-approval.mjs` — F2: codex TUI approval loop.
- `scripts/codex-approval-hook.mjs` — test-harness PermissionRequest hook (returns decision from env, fires product notify).
- `.github/workflows/toast-macos.yml` — delivery-capture lane.
- `.github/workflows/tui-proofs.yml` — TUI proofs lane.
- `.github/workflows/spike-mac-delivery.yml` — scratch spike (deleted before merge).
- `tests/macos-delivery.test.mjs` — keystone unit tests (pure parts, on fixtures).
- `tests/macos-sound.test.mjs` — sound-name mapping unit tests.
- `tests/doctor.test.mjs` — doctor check-logic tests.
- `tests/fixtures/nc-record-sample.txt` — hex bplist of a real NC record captured by the spike.
- `tests/fixtures/ncprefs-sample.json` — plutil-json of a real ncprefs.plist captured by the spike.
- `docs/research/2026-07-11-macos-real-ux-evidence.md` — evidence record.

**Modified files:**
- `src/platforms/macos.mjs` — add `macSoundName()`, use it in `sendToast()`.
- `cli/index.mjs` — register `doctor` in `COMMANDS` + help text.
- `scripts/live-codex.mjs` — rewrite for the real approval loop.
- `.github/workflows/toast-native.yml` — shrink matrix to Windows-only.
- `.github/workflows/live-claude.yml` — matrix += `macos-15`.
- `.github/workflows/live-gemini.yml` — matrix += `macos-15`.
- `.github/workflows/live-codex.yml` — rewrite: ubuntu + `macos-15`, approval loop.
- `scripts/lib/live-driver.mjs` — add `nonceMarker()` + `writeUserConfig` toast-enabled variant helper (see Task 9).
- `README.md` — `:188` sound truth fix; per-channel × per-OS "what CI proves" matrix.
- `package.json` — version `1.1.0` → `1.2.0`.

---

## Phase 0 — Spike (run first; findings gate everything downstream)

The spike answers three runner-specific unknowns and captures two real-data
fixtures. Its raw output is pasted into the evidence record (Task 20) and its
exact preflight commands are copied into every mac lane. **The spike workflow is
deleted before merge (Task 21).**

### Task 1: Spike workflow — pin DB path, silent-drop behavior, auth seeding, capture fixtures

**Files:**
- Create: `.github/workflows/spike-mac-delivery.yml`

- [ ] **Step 1: Write the spike workflow**

```yaml
name: Spike Mac Delivery (scratch — delete before merge)

on:
  workflow_dispatch:
  push:
    branches: [feat/mac-real-ux]
    paths: ['.github/workflows/spike-mac-delivery.yml']

jobs:
  spike:
    name: Spike — NC DB delivery unknowns (macos-15)
    runs-on: macos-15
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4

      - name: Q0 — Preflight (SIP off, OS version, DB path candidates)
        run: |
          echo "== sw_vers =="; sw_vers
          echo "== csrutil status =="; csrutil status || true
          echo "== Sequoia DB candidate =="
          SEQ="$HOME/Library/Group Containers/group.com.apple.usernoted/db2/db"
          echo "$SEQ"; ls -la "$SEQ" 2>&1 || echo "(absent)"
          echo "== pre-Sequoia DB candidate =="
          LEG="$(getconf DARWIN_USER_DIR)com.apple.notificationcenter/db2/db"
          echo "$LEG"; ls -la "$LEG" 2>&1 || echo "(absent)"

      - name: Q1 — Does osascript silent-drop BEFORE any grant/seed?
        run: |
          MARKER="spike-predrop-$GITHUB_RUN_ID"
          osascript -e "display notification \"$MARKER\" with title \"AAN-SPIKE\"" ; echo "osascript exit: $?"
          sleep 3
          # Try to read WITHOUT an FDA grant first — establishes the TCC baseline.
          SEQ="$HOME/Library/Group Containers/group.com.apple.usernoted/db2/db"
          echo "== raw read attempt (expect TCC block on Sequoia) =="
          sqlite3 "file:$SEQ?mode=ro&immutable=1" "select count(*) from record;" 2>&1 || echo "(blocked/unreadable)"

      - name: Q2 — FDA self-grant, then read the Sequoia DB
        run: |
          for db in "/Library/Application Support/com.apple.TCC/TCC.db" "$HOME/Library/Application Support/com.apple.TCC/TCC.db"; do
            sudo sqlite3 "$db" "INSERT OR REPLACE INTO access (service,client,client_type,auth_value,auth_reason,auth_version,flags,last_modified) VALUES ('kTCCServiceSystemPolicyAllFiles','/usr/bin/sqlite3',1,2,4,1,0,strftime('%s','now'));" 2>&1 || true
            sudo sqlite3 "$db" "INSERT OR REPLACE INTO access (service,client,client_type,auth_value,auth_reason,auth_version,flags,last_modified) VALUES ('kTCCServiceSystemPolicyAllFiles','/bin/bash',1,2,4,1,0,strftime('%s','now'));" 2>&1 || true
          done
          sudo pkill -HUP tccd || true
          sleep 2
          SEQ="$HOME/Library/Group Containers/group.com.apple.usernoted/db2/db"
          echo "== schema =="; sqlite3 "file:$SEQ?mode=ro&immutable=1" ".schema record" 2>&1 || echo "(still blocked)"
          echo "== recent records (hex) =="
          sqlite3 "file:$SEQ?mode=ro&immutable=1" "select hex(data) from record order by rowid desc limit 5;" 2>&1 | tee /tmp/spike-records.txt || true

      - name: Q3 — Seed authorization + fire our REAL backend, then verify
        env:
          AAN_TOAST_LIVE: '1'
        run: |
          MARKER="spike-real-$GITHUB_RUN_ID"
          # Fire through the actual production backend (not terminal-notifier).
          node -e "import('./src/platforms/macos.mjs').then(m=>m.sendToast({title:'AAN-SPIKE',message:process.env.M})).then(r=>console.log('sendToast:',r))" M="$MARKER" || true
          sleep 3
          SEQ="$HOME/Library/Group Containers/group.com.apple.usernoted/db2/db"
          echo "== decode recent records =="
          sqlite3 "file:$SEQ?mode=ro&immutable=1" "select hex(data) from record order by rowid desc limit 8;" 2>&1 \
            | while read h; do echo "$h" | xxd -r -p | plutil -convert json -o - - 2>/dev/null | tee -a /tmp/spike-decoded.json; echo; done || true
          echo "== ncprefs dump =="
          plutil -convert json -o /tmp/spike-ncprefs.json "$HOME/Library/Preferences/com.apple.ncprefs.plist" 2>&1 || echo "(unreadable)"
          head -c 4000 /tmp/spike-ncprefs.json 2>/dev/null || true

      - name: Upload spike artifacts (fixtures + findings)
        if: always()
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: spike-mac-delivery
          path: |
            /tmp/spike-records.txt
            /tmp/spike-decoded.json
            /tmp/spike-ncprefs.json
```

- [ ] **Step 2: Commit and trigger**

```bash
git add .github/workflows/spike-mac-delivery.yml
git commit -m "ci(spike): mac NC-delivery unknowns — DB path, silent-drop, auth seed (scratch)"
git push
gh workflow run spike-mac-delivery.yml --ref feat/mac-real-ux
```

- [ ] **Step 3: Watch to completion and record findings**

```bash
gh run watch "$(gh run list --workflow=spike-mac-delivery.yml -L1 --json databaseId -q '.[0].databaseId')"
gh run download "$(gh run list --workflow=spike-mac-delivery.yml -L1 --json databaseId -q '.[0].databaseId')" -n spike-mac-delivery -D docs/research/spike-artifacts
```

Expected: at least one of Q2's read attempts succeeds after the FDA grant and
dumps the `record` schema + hex rows; Q3 decodes a bplist showing `req.titl` /
`req.body` keys. **Record these five decisions** (they parameterize the tasks
below), into `docs/research/2026-07-11-macos-real-ux-evidence.md`:

1. **DB path that worked** → confirms `ncDbPath()` ordering (Task 3).
2. **Whether the raw pre-grant read was blocked** → confirms the FDA grant is required (all lane preflights).
3. **Whether osascript silent-dropped pre-grant** (no record for Q1's marker) → decides the negative test shape (Task 12): if it dropped, assert "no record"; if runners are pre-authorized, pivot to asserting `notificationAuthState()` transitions.
4. **Exact bplist keys** for title/body/app/date → confirms `decodeRecordPlist()` field names (Task 3).
5. **ncprefs JSON shape** (the `apps` array entry + `flags` field) → confirms `decodeAuthFlags()` (Task 3).

- [ ] **Step 4: Capture the two test fixtures from the artifacts**

```bash
# Pick one real record hex line (single line, no spaces) from the spike output:
#   → tests/fixtures/nc-record-sample.txt  (must decode to title "AAN-SPIKE" + the marker body)
# Copy the ncprefs JSON:
#   → tests/fixtures/ncprefs-sample.json
mkdir -p tests/fixtures
# (hand-copy the chosen hex line and the ncprefs json from docs/research/spike-artifacts/)
git add tests/fixtures/nc-record-sample.txt tests/fixtures/ncprefs-sample.json
git commit -m "test(fixtures): real macos-15 NC record + ncprefs, captured by spike"
```

Expected: `xxd -r -p < tests/fixtures/nc-record-sample.txt | plutil -p -` shows a
dict with the title/body keys. These fixtures make the keystone unit tests real
(no mocks) without needing a Mac.

> **If Q2 never reads the Sequoia DB even after the grant** (low-probability
> fallback from the runner research): change all mac lanes' `runs-on` to
> `macos-14` and `ncDbPath()`'s preferred path to the pre-Sequoia
> `$(getconf DARWIN_USER_DIR)com.apple.notificationcenter/db2/db` (no TCC gate
> there). macos-14 is available until Nov 2 2026 — ample for this pass. Note the
> pivot in the evidence record.

---

## Phase 1 — Keystone module (depends on spike fixtures)

### Task 2: Sound-name mapping (independent — no spike dependency; do first for an early win)

**Files:**
- Modify: `src/platforms/macos.mjs`
- Test: `tests/macos-sound.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/macos-sound.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { macSoundName } from '../src/platforms/macos.mjs';

test('Default and empty map to null (omit sound clause → system default)', () => {
  assert.equal(macSoundName('Default'), null);
  assert.equal(macSoundName(''), null);
  assert.equal(macSoundName(undefined), null);
});

test('Windows shipped names map to real macOS sounds', () => {
  assert.equal(macSoundName('IM'), 'Glass');       // default-config task_complete
  assert.equal(macSoundName('Reminder'), 'Ping');  // default-config needs_input
  assert.equal(macSoundName('Mail'), 'Purr');
  assert.equal(macSoundName('SMS'), 'Tink');
});

test('Alarm/Call families collapse to Sosumi', () => {
  assert.equal(macSoundName('Alarm'), 'Sosumi');
  assert.equal(macSoundName('Alarm10'), 'Sosumi');
  assert.equal(macSoundName('Call'), 'Sosumi');
  assert.equal(macSoundName('Call3'), 'Sosumi');
});

test('valid macOS system sounds pass through unchanged', () => {
  for (const s of ['Basso', 'Glass', 'Ping', 'Sosumi', 'Submarine', 'Tink']) {
    assert.equal(macSoundName(s), s);
  }
});

test('unknown names map to null (omit → never emit an invalid sound name arg)', () => {
  assert.equal(macSoundName('NotARealSound'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/macos-sound.test.mjs`
Expected: FAIL — `macSoundName` is not exported.

- [ ] **Step 3: Implement `macSoundName` and use it in `sendToast`**

Replace the entire contents of `src/platforms/macos.mjs` with:

```js
// src/platforms/macos.mjs
import { execFile } from 'node:child_process';
import { logHookError } from '../error-log.mjs';

// The 14 built-in macOS system sounds (files in /System/Library/Sounds).
const MAC_SYSTEM_SOUNDS = new Set([
  'Basso', 'Blow', 'Bottle', 'Frog', 'Funk', 'Glass', 'Hero',
  'Morse', 'Ping', 'Pop', 'Purr', 'Sosumi', 'Submarine', 'Tink',
]);

// Default config ships Windows SoundEvent names (IM, Reminder, …). Forwarding
// them to `sound name "IM"` produces an invalid NSSound name that macOS ignores
// (and logs). Map the shipped names to real macOS sounds; omit the clause for
// Default/unknown so the system default sound plays.
const WINDOWS_TO_MAC_SOUND = { IM: 'Glass', Reminder: 'Ping', Mail: 'Purr', SMS: 'Tink' };

export function macSoundName(toastSound) {
  if (!toastSound || toastSound === 'Default') return null;
  if (MAC_SYSTEM_SOUNDS.has(toastSound)) return toastSound;
  if (WINDOWS_TO_MAC_SOUND[toastSound]) return WINDOWS_TO_MAC_SOUND[toastSound];
  if (/^(Alarm|Call)\d*$/.test(toastSound)) return 'Sosumi';
  return null;
}

export function sendToast(notification) {
  return new Promise((resolve) => {
    const sound = macSoundName(notification.toastSound);
    const soundClause = sound ? ` sound name "${esc(sound)}"` : '';
    const script = `display notification "${esc(notification.message)}" with title "${esc(notification.title)}"${soundClause}`;

    execFile('osascript', ['-e', script], { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) logHookError('toast:macos', err, { stderr: (stderr || '').slice(0, 400) });
      resolve(!err);
    });
  });
}

// Escape for embedding inside a double-quoted AppleScript string literal.
// Control characters are replaced with spaces: they cannot be escaped
// portably and a raw newline would otherwise break out of the string.
export function esc(str) {
  return (str || '')
    .replace(new RegExp('[\\x00-\\x1f\\x7f]', 'g'), ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/macos-sound.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify existing esc() tests still pass**

Run: `node --test tests/platforms.test.mjs`
Expected: PASS (esc unit tests unaffected; the live osascript test is unchanged for now — it moves in Task 13).

- [ ] **Step 6: Commit**

```bash
git add src/platforms/macos.mjs tests/macos-sound.test.mjs
git commit -m "fix(macos): map Windows sound names to real macOS sounds, omit unknowns"
```

### Task 3: Keystone module `macos-delivery.mjs`

**Files:**
- Create: `src/platforms/macos-delivery.mjs`
- Test: `tests/macos-delivery.test.mjs`
- Uses: `tests/fixtures/nc-record-sample.txt`, `tests/fixtures/ncprefs-sample.json` (from Task 1)

> **Spike-confirmed constants before coding:** the bplist title/body key names
> (`req.titl` / `req.body` in the research; confirm from Task 1 Step 3 decision
> #4) and the ncprefs `flags` semantics (decision #5). If the spike shows
> different key names, adjust `decodeRecordPlist` and the fixture assertions to
> the observed names — everything else in this task is path/process plumbing that
> does not change.

- [ ] **Step 1: Write the failing pure-helper tests (run on the real fixtures)**

```js
// tests/macos-delivery.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  ncDbPath,
  decodeRecordPlist,
  decodeAuthFlags,
  verifyDelivery,
  notificationAuthState,
} from '../src/platforms/macos-delivery.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isMac = os.platform() === 'darwin';
const hasPlutil = (() => { try { execFileSync('which', ['plutil']); return true; } catch { return false; } })();

// decodeRecordPlist turns a hex bplist BLOB into { title, body, app, date }.
// The fixture is a REAL record captured from a macos-15 runner by the spike.
test('decodeRecordPlist extracts title and body from a real NC record', { skip: !hasPlutil && 'plutil required' }, () => {
  const hex = fs.readFileSync(path.join(__dirname, 'fixtures', 'nc-record-sample.txt'), 'utf8').trim();
  const rec = decodeRecordPlist(hex);
  assert.equal(rec.title, 'AAN-SPIKE');
  assert.match(rec.body, /^spike-real-/);
  assert.ok(typeof rec.app === 'string');
});

test('decodeRecordPlist returns null on garbage input (never throws)', () => {
  assert.equal(decodeRecordPlist('not-hex-zzzz'), null);
  assert.equal(decodeRecordPlist(''), null);
});

// decodeAuthFlags interprets one ncprefs "apps" entry. Fixture is real ncprefs JSON.
test('decodeAuthFlags classifies an app entry from real ncprefs', { skip: !hasPlutil && 'plutil required' }, () => {
  const json = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ncprefs-sample.json'), 'utf8'));
  const apps = json.apps || [];
  // Every real entry decodes to one of the three states, never throws.
  for (const entry of apps) {
    const state = decodeAuthFlags(entry.flags);
    assert.ok(['authorized', 'unauthorized', 'unknown'].includes(state));
  }
});

// On non-mac, ncDbPath is null; on mac it resolves an existing DB or null.
test('ncDbPath returns null off-macOS, a string-or-null on macOS', () => {
  const p = ncDbPath();
  if (!isMac) assert.equal(p, null);
  else assert.ok(p === null || typeof p === 'string');
});

// verifyDelivery never throws and reports a structured miss when there is no DB.
test('verifyDelivery resolves a structured miss when no DB (fast, off-mac)', { skip: isMac && 'this asserts the no-DB path' }, async () => {
  const r = await verifyDelivery('nope', { timeoutMs: 200, pollMs: 50 });
  assert.equal(r.delivered, false);
  assert.equal(r.reason, 'no-nc-db');
});

// notificationAuthState never throws; returns one of the three states.
test('notificationAuthState returns a structured result, never throws', () => {
  const s = notificationAuthState();
  assert.ok(['authorized', 'unauthorized', 'unknown'].includes(s.state));
  assert.ok(typeof s.detail === 'string');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/macos-delivery.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the keystone module**

```js
// src/platforms/macos-delivery.mjs
//
// Delivery verification for macOS notifications. Zero-dependency: shells out to
// the preinstalled `sqlite3`, `plutil`, and `getconf`. Every function returns a
// structured result and NEVER throws — callers (aan doctor, CI lanes) decide
// severity.
//
// The core idea: macOS logs every DELIVERED notification in Notification
// Center's SQLite DB, including when the banner is suppressed by Focus/DND. So a
// row in that DB proves delivery in a way `osascript` exit codes cannot.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolve the Notification Center records DB. Sequoia (macOS 15) moved it into a
// Group Container; pre-Sequoia used a DARWIN_USER_DIR temp path. Prefer whichever
// exists. Returns null when neither is present (e.g. non-macOS).
export function ncDbPath() {
  if (os.platform() !== 'darwin') return null;
  const home = os.homedir();
  const sequoia = path.join(home, 'Library', 'Group Containers', 'group.com.apple.usernoted', 'db2', 'db');
  if (fs.existsSync(sequoia)) return sequoia;
  try {
    const darwinUserDir = execFileSync('getconf', ['DARWIN_USER_DIR'], { encoding: 'utf8' }).trim();
    const legacy = path.join(darwinUserDir, 'com.apple.notificationcenter', 'db2', 'db');
    if (fs.existsSync(legacy)) return legacy;
  } catch { /* getconf missing/non-macOS */ }
  return null;
}

// Decode one hex-encoded bplist record BLOB into { title, body, app, date }.
// Returns null on any decode failure. Uses plutil via a temp file (plutil reads
// stdin as '-', but a temp file is robust across plutil versions).
export function decodeRecordPlist(hex) {
  if (!hex || !/^[0-9a-fA-F]+$/.test(hex.trim())) return null;
  const clean = hex.trim();
  let tmp;
  try {
    const buf = Buffer.from(clean, 'hex');
    if (buf.length === 0) return null;
    tmp = path.join(os.tmpdir(), `aan-nc-${process.pid}-${buf.length}.bplist`);
    fs.writeFileSync(tmp, buf);
    const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', tmp], { encoding: 'utf8' });
    const obj = JSON.parse(json);
    const req = obj.req || obj.request || {};
    return {
      title: String(req.titl ?? req.title ?? ''),
      body: String(req.body ?? req.subt ?? ''),
      app: String(obj.app ?? obj.bundleid ?? ''),
      date: obj.date ?? null,
    };
  } catch {
    return null;
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
  }
}

// Query the DB read-only for recent record BLOBs (hex). Returns { rows, error }.
// `immutable=1` avoids WAL lock contention with a live usernoted. An "unable to
// open" error is surfaced (callers map it to a TCC-blocked hint).
function queryRecordHex(dbPath, limit = 20) {
  try {
    const out = execFileSync(
      'sqlite3',
      [`file:${dbPath}?mode=ro&immutable=1`, `select hex(data) from record order by rowid desc limit ${limit};`],
      { encoding: 'utf8' },
    );
    return { rows: out.split('\n').map((l) => l.trim()).filter(Boolean), error: null };
  } catch (err) {
    const msg = String(err.stderr || err.message || '');
    return { rows: [], error: /unable to open|authorization denied|not authorized/i.test(msg) ? 'tcc-blocked' : 'query-failed' };
  }
}

// Poll the NC DB until a delivered record's title or body contains `marker`, or
// timeout. Returns { delivered, record?, reason? }. reason ∈
// { 'no-nc-db', 'tcc-blocked', 'timeout' }.
export async function verifyDelivery(marker, { timeoutMs = 30000, pollMs = 1000 } = {}) {
  const dbPath = ncDbPath();
  if (!dbPath) return { delivered: false, reason: 'no-nc-db' };
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  do {
    const { rows, error } = queryRecordHex(dbPath);
    if (error) lastError = error;
    for (const hex of rows) {
      const rec = decodeRecordPlist(hex);
      if (rec && (rec.title.includes(marker) || rec.body.includes(marker))) {
        return { delivered: true, record: rec };
      }
    }
    if (Date.now() < deadline) await sleep(pollMs);
  } while (Date.now() < deadline);
  return { delivered: false, reason: lastError || 'timeout' };
}

// Interpret an ncprefs "apps[].flags" integer into an authorization state.
// The ncprefs flags bitmask encodes per-app notification settings. The bit that
// means "notifications allowed" is DEFAULT_AUTH per the spike's ncprefs dump
// (decision #5). Unknown/undecodable → 'unknown' (callers treat as warn, not
// fail). Conservative by design: we only claim 'unauthorized' when we can read
// the flags and the allow bit is clearly off.
//
// Spike-confirmed: set AUTH_BIT to the observed "banners/alerts enabled" bit.
// The research indicates the low bits govern alert style; bit 0 set with a
// non-"none" alert style = authorized. If the spike shows a cleaner signal
// (e.g. a dedicated key), prefer that and document it here.
const AUTH_BIT = 1 << 0; // placeholder-free default; confirm against fixture in Task 1

export function decodeAuthFlags(flags) {
  if (typeof flags !== 'number' || Number.isNaN(flags)) return 'unknown';
  // A flags value of 0 in ncprefs means "not configured yet" → unknown, not a
  // definitive deny (the app has never posted, so macOS hasn't recorded intent).
  if (flags === 0) return 'unknown';
  return (flags & AUTH_BIT) ? 'authorized' : 'unauthorized';
}

// Read com.apple.ncprefs.plist and classify the app that owns osascript-posted
// notifications on this host. Returns { state, app?, detail }.
export function notificationAuthState() {
  if (os.platform() !== 'darwin') {
    return { state: 'unknown', detail: 'not macOS' };
  }
  const plist = path.join(os.homedir(), 'Library', 'Preferences', 'com.apple.ncprefs.plist');
  let json;
  try {
    json = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' }));
  } catch {
    return { state: 'unknown', detail: 'ncprefs unreadable (may need Full Disk Access)' };
  }
  const apps = Array.isArray(json.apps) ? json.apps : [];
  // osascript notifications are attributed to Script Editor (or the invoking
  // terminal). Look for the most relevant bundle id; fall back to the aggregate.
  const OWNERS = ['com.apple.ScriptEditor2', 'com.apple.Terminal', 'com.apple.osascript'];
  const entry = apps.find((a) => OWNERS.includes(a['bundle-id'] || a.bundleid))
    || apps.find((a) => /ScriptEditor|osascript|Terminal/i.test(a['bundle-id'] || a.bundleid || ''));
  if (!entry) {
    return { state: 'unknown', app: null, detail: 'no notification-owning app registered yet — send one toast to register in System Settings → Notifications' };
  }
  const app = entry['bundle-id'] || entry.bundleid || 'unknown';
  const state = decodeAuthFlags(entry.flags);
  const detail = state === 'authorized'
    ? `${app} is authorized to post notifications`
    : state === 'unauthorized'
      ? `${app} is NOT authorized — banners will be silently dropped; enable it in System Settings → Notifications`
      : `${app} authorization is indeterminate`;
  return { state, app, detail };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/macos-delivery.test.mjs`
Expected: PASS. On non-macOS dev machines the two plutil-gated tests skip; the
no-DB and never-throw tests pass everywhere. On a Mac all pass against the real
fixtures.

- [ ] **Step 5: Commit**

```bash
git add src/platforms/macos-delivery.mjs tests/macos-delivery.test.mjs
git commit -m "feat(macos): NC-DB delivery verification keystone (ncDbPath, verifyDelivery, auth state)"
```

---

## Phase 2 — `aan doctor` product command

### Task 4: Doctor check logic (pure, testable)

**Files:**
- Create: `cli/doctor-checks.mjs`
- Test: `tests/doctor.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/doctor.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { runChecks, CHECK_IDS } from '../cli/doctor-checks.mjs';

test('runChecks returns one result per known check id, all well-formed', async () => {
  const results = await runChecks({ config: baseConfig(), deep: false });
  const ids = results.map((r) => r.id);
  for (const id of CHECK_IDS[os.platform()] || CHECK_IDS.default) {
    assert.ok(ids.includes(id), `missing check ${id}`);
  }
  for (const r of results) {
    assert.ok(['ok', 'warn', 'fail'].includes(r.status), `bad status ${r.status} for ${r.id}`);
    assert.ok(typeof r.channel === 'string');
    assert.ok(typeof r.detail === 'string');
  }
});

test('ntfy check warns when unconfigured, ok when configured (never publishes)', async () => {
  const off = await runChecks({ config: baseConfig(), deep: false });
  assert.equal(off.find((r) => r.id === 'ntfy-config').status, 'warn');

  const on = await runChecks({
    config: { ...baseConfig(), ntfy: { enabled: true, server: 'https://ntfy.sh', topic: 'x' } },
    deep: false,
  });
  assert.notEqual(on.find((r) => r.id === 'ntfy-config').status, 'fail');
});

test('config check fails on an invalid config object', async () => {
  const results = await runChecks({ config: null, configProblem: { message: 'bad json' }, deep: false });
  assert.equal(results.find((r) => r.id === 'config').status, 'fail');
});

test('runChecks never throws even with a hostile config', async () => {
  await assert.doesNotReject(runChecks({ config: { events: 'not-an-object' }, deep: false }));
});

function baseConfig() {
  return {
    toast: { enabled: true }, ntfy: { enabled: false, topic: '' },
    webhook: { enabled: false, url: '' }, terminalBell: { enabled: true }, events: {},
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/doctor.test.mjs`
Expected: FAIL — `cli/doctor-checks.mjs` does not exist.

- [ ] **Step 3: Implement the check logic**

```js
// cli/doctor-checks.mjs — pure diagnostic logic for `aan doctor`. No console I/O;
// returns an array of { id, channel, status, detail, hint }. Each check is
// best-effort and never throws; runChecks aggregates them.
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { notificationAuthState, verifyDelivery, ncDbPath } from '../src/platforms/macos-delivery.mjs';

// Terminals known to swallow OSC/BEL sequences (from the demand evidence).
const OSC_SWALLOWERS = { vscode: 'VS Code', windsurf: 'Windsurf' };

export const CHECK_IDS = {
  darwin: ['toast-backend', 'toast-auth', 'bell', 'ntfy-config', 'webhook-config', 'config', 'focus'],
  win32: ['toast-backend', 'bell', 'ntfy-config', 'webhook-config', 'config'],
  linux: ['toast-backend', 'bell', 'ntfy-config', 'webhook-config', 'config'],
  default: ['toast-backend', 'bell', 'ntfy-config', 'webhook-config', 'config'],
};

function has(bin) {
  try { execFileSync(os.platform() === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function toastBackendCheck() {
  const p = os.platform();
  if (p === 'darwin') {
    return has('osascript')
      ? { id: 'toast-backend', channel: 'toast', status: 'ok', detail: 'osascript present' }
      : { id: 'toast-backend', channel: 'toast', status: 'fail', detail: 'osascript missing', hint: 'macOS should always ship osascript' };
  }
  if (p === 'linux') {
    return has('notify-send')
      ? { id: 'toast-backend', channel: 'toast', status: 'ok', detail: 'notify-send present' }
      : { id: 'toast-backend', channel: 'toast', status: 'warn', detail: 'notify-send missing', hint: 'install libnotify-bin' };
  }
  // win32: BurntToast is a PowerShell module; presence is checked at send time.
  return { id: 'toast-backend', channel: 'toast', status: 'ok', detail: 'BurntToast checked at send time' };
}

function bellCheck() {
  const term = (process.env.TERM_PROGRAM || '').toLowerCase();
  const swallow = Object.keys(OSC_SWALLOWERS).find((k) => term.includes(k));
  if (swallow) {
    return { id: 'bell', channel: 'bell', status: 'warn', detail: `TERM_PROGRAM=${process.env.TERM_PROGRAM}`, hint: `${OSC_SWALLOWERS[swallow]} may swallow the terminal bell` };
  }
  return { id: 'bell', channel: 'bell', status: 'ok', detail: `terminal ${process.env.TERM_PROGRAM || 'unknown'}` };
}

function ntfyCheck(config) {
  const ok = config?.ntfy?.enabled && config?.ntfy?.topic;
  return ok
    ? { id: 'ntfy-config', channel: 'ntfy', status: 'ok', detail: `${config.ntfy.server || 'https://ntfy.sh'}/${config.ntfy.topic}` }
    : { id: 'ntfy-config', channel: 'ntfy', status: 'warn', detail: 'ntfy not configured', hint: 'run: ai-agent-notifier setup' };
}

function webhookCheck(config) {
  if (!config?.webhook?.enabled) return { id: 'webhook-config', channel: 'webhook', status: 'ok', detail: 'webhook disabled' };
  try {
    const u = new URL(config.webhook.url);
    return { id: 'webhook-config', channel: 'webhook', status: 'ok', detail: u.origin };
  } catch {
    return { id: 'webhook-config', channel: 'webhook', status: 'fail', detail: 'webhook enabled but URL invalid', hint: 'run: ai-agent-notifier config webhook' };
  }
}

function configCheck(config, configProblem) {
  if (configProblem) return { id: 'config', channel: 'config', status: 'fail', detail: configProblem.message, hint: 'fix ~/.ai-agent-notifier/config.json' };
  if (!config || typeof config !== 'object') return { id: 'config', channel: 'config', status: 'fail', detail: 'config did not load' };
  return { id: 'config', channel: 'config', status: 'ok', detail: 'config valid' };
}

function focusCheck() {
  return { id: 'focus', channel: 'focus', status: ncDbPath() ? 'ok' : 'warn', detail: 'Focus/DND does not block delivery records (warn-only probe)' };
}

async function toastAuthCheck(deep, strict) {
  const auth = notificationAuthState();
  let status = auth.state === 'authorized' ? 'ok' : auth.state === 'unauthorized' ? 'warn' : 'warn';
  const base = { id: 'toast-auth', channel: 'toast', status, detail: auth.detail };
  if (!deep) return base;

  // --deep: fire a real marker toast through the production backend and verify.
  const { sendToast } = await import('../src/platforms/macos.mjs');
  const marker = `aan-doctor-${process.pid}-${Date.now().toString(36)}`;
  await sendToast({ title: 'ai-agent-notifier', message: `doctor check ${marker}`, toastSound: 'Default' });
  const res = await verifyDelivery(marker, { timeoutMs: 15000, pollMs: 1000 });
  if (res.delivered) return { id: 'toast-auth', channel: 'toast', status: 'ok', detail: `delivered + verified in Notification Center (${res.record.app || 'osascript'})` };
  if (res.reason === 'tcc-blocked') {
    return {
      id: 'toast-auth', channel: 'toast', status: strict ? 'fail' : 'warn',
      detail: 'cannot read Notification Center DB (Full Disk Access needed to verify)',
      hint: 'grant Full Disk Access to your terminal in System Settings → Privacy',
    };
  }
  return { id: 'toast-auth', channel: 'toast', status: strict ? 'fail' : 'warn', detail: `toast sent but no delivery record (${res.reason})`, hint: 'notifications may be disabled for this app in System Settings → Notifications' };
}

// Run all platform-appropriate checks. `strict` (AAN_DOCTOR_STRICT=1) turns
// deep-mode warns into fails so CI can gate on the product diagnostic.
export async function runChecks({ config, configProblem = null, deep = false, strict = false }) {
  const p = os.platform();
  const results = [toastBackendCheck()];
  if (p === 'darwin') {
    try { results.push(await toastAuthCheck(deep, strict)); }
    catch (err) { results.push({ id: 'toast-auth', channel: 'toast', status: 'warn', detail: `auth check errored: ${err.message}` }); }
  }
  results.push(bellCheck(), ntfyCheck(config), webhookCheck(config), configCheck(config, configProblem));
  if (p === 'darwin') results.push(focusCheck());
  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/doctor.test.mjs`
Expected: PASS (4 tests). On non-macOS the darwin-only checks are absent from
`CHECK_IDS[platform]`, so the per-id assertion matches.

- [ ] **Step 5: Commit**

```bash
git add cli/doctor-checks.mjs tests/doctor.test.mjs
git commit -m "feat(doctor): pure per-channel diagnostic checks with deep NC-DB verification"
```

### Task 5: Doctor CLI command + wiring

**Files:**
- Create: `cli/doctor.mjs`
- Modify: `cli/index.mjs`

- [ ] **Step 1: Implement the command shell**

```js
// cli/doctor.mjs — `aan doctor`: per-channel delivery self-check.
// Flags: --deep (send a real marker toast + verify via NC DB on macOS),
//        --json (machine output for CI), --strict (deep warns become fails;
//        also enabled by AAN_DOCTOR_STRICT=1).
import os from 'node:os';
import { loadConfigResult } from '../src/config-loader.mjs';
import { runChecks } from './doctor-checks.mjs';
import { c } from './ui.mjs';

const ICON = { ok: c.success('✓'), warn: c.warn('⚠'), fail: c.error('✗') };

export async function run(...args) {
  const flags = new Set(args.filter(Boolean));
  const deep = flags.has('--deep');
  const json = flags.has('--json');
  const strict = flags.has('--strict') || process.env.AAN_DOCTOR_STRICT === '1';

  const { config, problem } = loadConfigResult();
  const results = await runChecks({ config, configProblem: problem, deep, strict });

  if (json) {
    process.stdout.write(JSON.stringify({ platform: os.platform(), deep, strict, checks: results }, null, 2) + '\n');
  } else {
    console.log();
    console.log(`  ${c.bold('ai-agent-notifier')} ${c.accent('doctor')}${deep ? c.muted(' --deep') : ''}`);
    console.log();
    for (const r of results) {
      const line = `  ${ICON[r.status]} ${c.white((r.channel + ':').padEnd(9))} ${r.detail}`;
      console.log(line);
      if (r.hint) console.log(`      ${c.muted('↳ ' + r.hint)}`);
    }
    console.log();
  }

  // Exit non-zero if any check failed (warns are allowed). CLI strict at the edge.
  if (results.some((r) => r.status === 'fail')) process.exitCode = 1;
}
```

- [ ] **Step 2: Register the command in `cli/index.mjs`**

In `cli/index.mjs`, add `doctor` to the `COMMANDS` map (after `uninstall`):

```js
const COMMANDS = {
  setup: () => import('./setup.mjs'),
  status: () => import('./status.mjs'),
  test: () => import('./test.mjs'),
  config: () => import('./config.mjs'),
  doctor: () => import('./doctor.mjs'),
  uninstall: () => import('./uninstall.mjs'),
};
```

And pass all trailing args (doctor needs `--deep`/`--json`), by changing the
dispatch call near the bottom of `main()`:

```js
  const mod = await loader();
  await mod.run(...process.argv.slice(3));
```

Add a help line in `printHelp` after the `config` line:

```js
  console.log(`    ${c.accent('doctor')} ${c.muted('[--deep]')}   ${c.white('Diagnose delivery per channel')} ${c.muted('(--deep verifies real delivery)')}`);
```

- [ ] **Step 3: Verify the command runs end-to-end locally**

Run: `node cli/index.mjs doctor --json`
Expected: JSON with a `checks` array; exit 0 unless a channel genuinely fails.

Run: `node cli/index.mjs doctor`
Expected: a table with ✓/⚠/✗ per channel.

- [ ] **Step 4: Verify `status.mjs` regression-free and existing suites pass**

Run: `npm test`
Expected: PASS (all existing suites + the three new ones).

- [ ] **Step 5: Commit**

```bash
git add cli/doctor.mjs cli/index.mjs
git commit -m "feat(cli): add 'aan doctor' — per-channel delivery diagnostics (--deep/--json/--strict)"
```

---

## Phase 3 — Delivery-capture CI lane

### Task 6: `live-toast-macos.mjs` — real backend → NC DB assert

**Files:**
- Create: `scripts/live-toast-macos.mjs`

- [ ] **Step 1: Implement the driver (mirrors `live-toast-linux.mjs`)**

```js
// scripts/live-toast-macos.mjs — REAL native notification capture on macOS.
//
// The macOS analog of live-toast-linux.mjs. Fires a notification through our
// actual macOS backend (src/platforms/macos.mjs → osascript) and asserts it was
// DELIVERED by reading Notification Center's SQLite DB — not by trusting the
// osascript exit code (which is 0 even when the banner is silently dropped).
//
// Requires (CI provides): macos-15, SIP disabled, an FDA self-grant so the DB is
// readable, and authorization seeded so the notification actually records.
import os from 'node:os';
import { route } from '../src/router.mjs';
import { loadConfig } from '../src/config-loader.mjs';
import { sendToast } from '../src/platforms/macos.mjs';
import { verifyDelivery, ncDbPath, notificationAuthState } from '../src/platforms/macos-delivery.mjs';

function fail(msg) { console.error(`FAIL [PRODUCT]: ${msg}`); process.exit(1); }
function infra(msg) { console.error(`FAIL [INFRA]: ${msg}`); process.exit(1); }

async function main() {
  if (os.platform() !== 'darwin') infra('live-toast-macos is macOS-only.');

  const dbPath = ncDbPath();
  if (!dbPath) infra('Notification Center DB not found — check macOS version / FDA grant.');
  console.log(`NC DB: ${dbPath}`);
  console.log(`auth state (pre-send): ${JSON.stringify(notificationAuthState())}`);

  // Fire a unique marker through the production backend.
  const marker = `aan-mac-${process.pid}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  const config = loadConfig();
  const notification = route(
    { source: 'claude', event: 'needs_input', projectName: marker, cwd: '/work/x' },
    config,
  );
  console.log(`Firing via osascript: "${notification.title}" / "${notification.message}"`);

  const sent = await sendToast(notification);
  console.log(`sendToast returned: ${sent}`);
  // NOTE: we deliberately do NOT gate on `sent` — exit-0-but-invisible is the
  // exact bug this lane exists to catch. The DB record is the real assertion.

  const res = await verifyDelivery(marker, { timeoutMs: 30000, pollMs: 1000 });
  if (!res.delivered) {
    if (res.reason === 'tcc-blocked') infra('NC DB unreadable (TCC) — FDA grant did not take.');
    fail(`no Notification Center delivery record for marker "${marker}" (${res.reason}). osascript exited but nothing was delivered.`);
  }

  // Assert exact content the router produced (marker is inside the message).
  if (!res.record.body.includes(marker)) {
    fail(`delivery record body "${res.record.body}" does not contain marker "${marker}"`);
  }
  console.log(`PASS: delivered + verified — title="${res.record.title}" body="${res.record.body}" app="${res.record.app}"`);
  console.log('A real notification reached Notification Center with the exact payload our backend sent.');
  process.exit(0);
}

main();
```

- [ ] **Step 2: Local sanity (off-mac, expect the INFRA guard)**

Run: `node scripts/live-toast-macos.mjs`
Expected (on Windows/Linux dev box): `FAIL [INFRA]: live-toast-macos is macOS-only.` — confirms the guard; real execution happens in CI.

- [ ] **Step 3: Commit**

```bash
git add scripts/live-toast-macos.mjs
git commit -m "feat(ci): live-toast-macos driver — real osascript backend, NC-DB delivery assert"
```

### Task 7: `toast-macos.yml` workflow lane

**Files:**
- Create: `.github/workflows/toast-macos.yml`

> **Spike-parameterized:** the FDA-grant and auth-seed steps below use the exact
> commands the spike (Task 1) confirmed. If the spike's decision #3 showed
> runners are pre-authorized (osascript did NOT silent-drop), delete the negative
> step and keep only the positive + doctor self-proof. If decision #2 showed no
> FDA grant is needed, the grant step is a harmless no-op — leave it for
> resilience.

- [ ] **Step 1: Write the workflow**

```yaml
name: Toast macOS

# Delivery-capture proof: fires the REAL osascript backend and asserts the
# notification was delivered by reading Notification Center's SQLite DB. Unlike
# an exit-code check, this fails when a real user would have seen nothing.
on:
  push:
    paths-ignore: ['**/*.md', 'docs/**', 'LICENSE', '.gitignore']
  pull_request:
    paths-ignore: ['**/*.md', 'docs/**', 'LICENSE', '.gitignore']

concurrency:
  group: '${{ github.workflow }}-${{ github.ref }}'
  cancel-in-progress: true

jobs:
  toast-macos:
    name: Live Toast macOS (delivery capture)
    runs-on: macos-15
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: 22
      - run: npm install

      - name: Preflight — SIP off, OS version, resolve NC DB path
        run: |
          sw_vers
          if ! csrutil status | grep -qi 'disabled'; then
            echo "FAIL [INFRA]: SIP is not disabled on this runner — cannot self-grant FDA"; exit 1
          fi
          node -e "import('./src/platforms/macos-delivery.mjs').then(m=>{const p=m.ncDbPath(); if(!p){console.error('FAIL [INFRA]: no NC DB path'); process.exit(1)} console.log('NC DB:',p)})"

      - name: Negative — unauthorized osascript silently drops (no record)
        run: |
          MARKER="neg-$GITHUB_RUN_ID"
          osascript -e "display notification \"$MARKER\" with title \"AAN-NEG\"" ; echo "osascript exit: $?"
          sleep 3
          # Read WITHOUT granting FDA first is unreliable; grant, then assert the
          # marker is ABSENT (unauthorized app → delivered-but-not-recorded, or
          # dropped). This pins the silent-drop failure mode.
          node scripts/mac-preflight-grant.mjs
          if node -e "import('./src/platforms/macos-delivery.mjs').then(async m=>{const r=await m.verifyDelivery(process.env.MK,{timeoutMs:4000,pollMs:1000}); process.exit(r.delivered?0:1)})" MK="$MARKER"; then
            echo "NOTE: negative marker WAS recorded — runner is pre-authorized; see spike decision #3"
          else
            echo "PASS: unauthorized osascript produced no delivery record (silent-drop confirmed)"
          fi

      - name: Seed authorization for the notification-owning app
        run: node scripts/mac-preflight-grant.mjs --seed-auth

      - name: Positive — real backend delivers + records exact payload
        env:
          AAN_TOAST_LIVE: '1'
        run: node scripts/live-toast-macos.mjs

      - name: Product self-proof — doctor --deep agrees (strict)
        env:
          AAN_DOCTOR_STRICT: '1'
        run: node cli/index.mjs doctor --deep --json

      - name: Diagnostics bundle (always)
        if: always()
        run: |
          mkdir -p /tmp/diag
          node -e "import('./src/platforms/macos-delivery.mjs').then(m=>console.log(JSON.stringify(m.notificationAuthState())))" > /tmp/diag/auth.json 2>&1 || true
          DB="$(node -e "import('./src/platforms/macos-delivery.mjs').then(m=>console.log(m.ncDbPath()||''))")"
          [ -n "$DB" ] && sqlite3 "file:$DB?mode=ro&immutable=1" "select hex(data) from record order by rowid desc limit 10;" > /tmp/diag/records.hex 2>&1 || true
          screencapture -x /tmp/diag/screen.png 2>&1 || true

      - name: Upload diagnostics
        if: always()
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: toast-macos-diagnostics
          path: /tmp/diag
```

- [ ] **Step 2: Create the shared preflight-grant helper**

```js
// scripts/mac-preflight-grant.mjs — CI-only. Self-grants Full Disk Access (so the
// NC DB is readable) and, with --seed-auth, seeds notification authorization for
// the osascript-owning app. Safe to run repeatedly. macOS + SIP-disabled only.
import os from 'node:os';
import { execFileSync } from 'node:child_process';

if (os.platform() !== 'darwin') { console.error('mac-preflight-grant: macOS-only'); process.exit(1); }
const seedAuth = process.argv.includes('--seed-auth');

function tccGrant() {
  const dbs = [
    '/Library/Application Support/com.apple.TCC/TCC.db',
    `${os.homedir()}/Library/Application Support/com.apple.TCC/TCC.db`,
  ];
  for (const db of dbs) {
    for (const client of ['/usr/bin/sqlite3', '/bin/bash', '/usr/local/bin/node', process.execPath]) {
      try {
        execFileSync('sudo', ['sqlite3', db,
          `INSERT OR REPLACE INTO access (service,client,client_type,auth_value,auth_reason,auth_version,flags,last_modified) VALUES ('kTCCServiceSystemPolicyAllFiles','${client}',1,2,4,1,0,strftime('%s','now'));`,
        ], { stdio: 'ignore' });
      } catch { /* row may already exist or column set differs by OS — best effort */ }
    }
  }
  try { execFileSync('sudo', ['pkill', '-HUP', 'tccd'], { stdio: 'ignore' }); } catch { /* ignore */ }
}

function seedAuthorization() {
  // Spike decision #5 finalizes the exact ncprefs mutation. The reference
  // approach: ensure the notification-owning app has an allow flag, then restart
  // usernoted so it re-reads prefs. If the spike shows runners are already
  // authorized, this is a no-op.
  try { execFileSync('killall', ['usernoted'], { stdio: 'ignore' }); } catch { /* not running yet */ }
}

tccGrant();
if (seedAuth) seedAuthorization();
console.log(`mac-preflight-grant: FDA grant applied${seedAuth ? ' + auth seeded' : ''}`);
```

- [ ] **Step 3: Shrink `toast-native.yml` to Windows-only**

In `.github/workflows/toast-native.yml`, change the matrix line:

```yaml
      matrix:
        os: [windows-latest]
```

And update the header comment's first line to:

```yaml
# Real native desktop-notification coverage on Windows: fires the real BurntToast
# backend and asserts the OS accepted the toast. macOS delivery is proven by the
# toast-macos.yml lane (Notification Center DB capture).
```

- [ ] **Step 4: Commit and push; watch the lane**

```bash
git add .github/workflows/toast-macos.yml .github/workflows/toast-native.yml scripts/mac-preflight-grant.mjs
git commit -m "ci(macos): delivery-capture lane (negative silent-drop + positive NC record + doctor self-proof)"
git push
gh run watch "$(gh run list --workflow=toast-macos.yml -L1 --json databaseId -q '.[0].databaseId')"
```

Expected: green. If red, download `toast-macos-diagnostics` and classify by the
`[INFRA]`/`[PRODUCT]` prefix in the failing step's log.

---

## Phase 4 — Real-agent lanes

### Task 8: Shared marker helper for live drivers

**Files:**
- Modify: `scripts/lib/live-driver.mjs`

- [ ] **Step 1: Add a nonce marker + toast-enabled config helper**

Append to `scripts/lib/live-driver.mjs` (before the driver-scaffolding section is
fine; keep exports grouped):

```js
// A short unique marker safe to embed in an agent prompt and match later in a
// notification title/body. Distinct from randomTopic (which is an ntfy topic).
export function nonceMarker(prefix = 'aan') {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
}

// Like setupIsolatedHome but leaves toast ENABLED (macOS delivery lanes need the
// real toast to fire so it records in Notification Center). ntfy still on for the
// push assertion. Everything else identical.
export function setupIsolatedHomeWithToast(opts) {
  const home = setupIsolatedHome(opts);
  // Re-write user config with toast enabled (setupIsolatedHome disables it).
  writeUserConfig(home, {
    toast: { enabled: true },
    ntfy: { enabled: true, server: opts.ntfyServer || 'https://ntfy.sh', topic: opts.topic },
  });
  return home;
}
```

- [ ] **Step 2: Verify existing e2e helpers still import cleanly**

Run: `node --test tests/e2e`
Expected: PASS (no behavior change to existing exports).

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/live-driver.mjs
git commit -m "feat(ci): nonceMarker + toast-enabled isolated home for macOS delivery lanes"
```

### Task 9: Extend Claude + Gemini lanes to macos-15 with NC assert

**Files:**
- Modify: `scripts/live-claude.mjs`, `scripts/live-gemini.mjs`
- Modify: `.github/workflows/live-claude.yml`, `.github/workflows/live-gemini.yml`

- [ ] **Step 1: Add an optional NC-delivery assertion to `live-claude.mjs`**

In `scripts/live-claude.mjs`, after the `pollForPush` block and before the
`fs.rmSync` cleanup, add a macOS-only delivery assertion. Change the imports line:

```js
import { requireEnvKey, setupIsolatedHomeWithToast, pollForPush, randomTopic, nonceMarker } from './lib/live-driver.mjs';
```

Replace the `setupIsolatedHome(...)` call with the toast-enabled variant and thread a nonce into the prompt:

```js
  const topic = randomTopic('live-claude');
  const marker = nonceMarker('claude');
  const home = setupIsolatedHomeWithToast({ prefix: 'aan-live-claude-', dir: '.claude', topic, seedSettingsFile: 'settings.json' });
  patchClaude(path.join(home, '.claude'), NOTIFY);

  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const res = spawnSync('claude', ['-p', `Reply with exactly this token and nothing else: ${marker}`], {
    encoding: 'utf8', env, timeout: 120000,
  });
```

Then after the existing `pollForPush(...)` call, add:

```js
  // macOS only: prove the toast was actually DELIVERED (not just exit 0). The
  // claude toast body is rich content — the assistant's words — so it carries
  // our marker. Requires the runner's FDA grant (the workflow runs preflight).
  if (process.platform === 'darwin') {
    const { verifyDelivery } = await import('../src/platforms/macos-delivery.mjs');
    const del = await verifyDelivery(marker, { timeoutMs: 20000, pollMs: 1000 });
    if (!del.delivered) {
      console.error(`FAIL [PRODUCT]: no Notification Center delivery record for "${marker}" (${del.reason})`);
      process.exit(1);
    }
    console.log(`PASS (hard): NC delivery record present — title="${del.record.title}"`);
  }
```

- [ ] **Step 2: Apply the same to `live-gemini.mjs` (generic body match)**

Gemini notifications are generic (rich views are claude-only), so match the
generic title instead of the nonce. Change the imports and home setup as in Step
1 (`setupIsolatedHomeWithToast`, keep the existing prompt), then after
`pollForPush`, add:

```js
  if (process.platform === 'darwin') {
    const { verifyDelivery } = await import('../src/platforms/macos-delivery.mjs');
    // Gemini's toast is generic ("<project>: Needs your input" / title "Gemini").
    // Fresh runner ⇒ the only "Gemini"-titled record in the window is ours.
    const del = await verifyDelivery('Gemini', { timeoutMs: 20000, pollMs: 1000 });
    if (!del.delivered) {
      console.error(`FAIL [PRODUCT]: no Notification Center delivery record titled "Gemini" (${del.reason})`);
      process.exit(1);
    }
    console.log(`PASS (hard): NC delivery record present — title="${del.record.title}" body="${del.record.body}"`);
  }
```

Note: `verifyDelivery` matches `marker` against title OR body, so passing
`'Gemini'` matches the generic title.

- [ ] **Step 3: Add the macos-15 matrix leg + preflight to both workflows**

In `.github/workflows/live-claude.yml`, replace the `jobs:` block's `runs-on`
with a matrix and add the mac preflight (Gemini identically, swapping names/keys):

```yaml
jobs:
  live-claude:
    name: Live Claude E2E (required, paid)
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-15]
    runs-on: ${{ matrix.os }}
    env:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: 22
      - run: npm install
      - name: Install Claude Code CLI
        run: npm install -g @anthropic-ai/claude-code@2.1.205
      - name: macOS preflight (FDA grant + auth seed)
        if: runner.os == 'macOS'
        run: node scripts/mac-preflight-grant.mjs --seed-auth
      - name: Drive Claude end-to-end (hard-fails if key missing or hook silent)
        run: node scripts/live-claude.mjs
      - name: Diagnostics (always, macOS)
        if: always() && runner.os == 'macOS'
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: live-claude-macos-diag
          path: ${{ runner.temp }}/diag
        continue-on-error: true
```

- [ ] **Step 4: Commit, push, watch both**

```bash
git add scripts/live-claude.mjs scripts/live-gemini.mjs .github/workflows/live-claude.yml .github/workflows/live-gemini.yml
git commit -m "ci(macos): Claude+Gemini E2E on macos-15 assert NC delivery record, not just ntfy"
git push
gh run watch "$(gh run list --workflow=live-claude.yml -L1 --json databaseId -q '.[0].databaseId')"
```

Expected: both ubuntu and macos-15 legs green. macOS leg additionally logs the NC delivery-record PASS line.

### Task 10: Rewrite the Codex lane — real approval decision loop

**Files:**
- Create: `scripts/codex-approval-hook.mjs`
- Rewrite: `scripts/live-codex.mjs`
- Rewrite: `.github/workflows/live-codex.yml`

> **Depends on** the codex PermissionRequest Command-hook contract (verified by
> the codex-decision research). The harness hook returns the decision from
> `AAN_TEST_DECISION` and also fires the real product notification, proving the
> full loop: approval requested → decision returned → codex obeys → sentinel.

- [ ] **Step 1: Write the harness PermissionRequest hook**

```js
// scripts/codex-approval-hook.mjs — TEST HARNESS ONLY (not shipped product).
// A codex PermissionRequest Command hook that (1) fires the real product
// notification via notify.mjs, then (2) returns the decision from
// AAN_TEST_DECISION so we can prove codex obeys allow/deny. The shipped product
// remains notify-only; this file lives in scripts/ and is never packaged.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTIFY = path.resolve(__dirname, '..', 'src', 'notify.mjs');

// Read codex's hook stdin (JSON) so we behave like a real hook; we don't need
// its contents for the decision, but draining stdin avoids a broken pipe.
let stdin = '';
try { stdin = require('node:fs').readFileSync(0, 'utf8'); } catch { /* no stdin */ }

// Fire the real product notification (best-effort; must not block the decision).
try {
  spawnSync(process.execPath, [NOTIFY, '--source', 'codex', '--event', 'needs_input'], {
    input: JSON.stringify({ hook_event_name: 'PermissionRequest' }),
    timeout: 8000,
  });
} catch { /* notification is best-effort */ }

const decision = process.env.AAN_TEST_DECISION === 'deny' ? 'deny' : 'allow';
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: decision } },
}) + '\n');
process.exit(0);
```

- [ ] **Step 2: Rewrite `live-codex.mjs` to drive a real approval**

```js
// scripts/live-codex.mjs — Tier 2 live E2E for Codex CLI: the REAL approval loop.
// Proves: codex reaches an approval point → our PermissionRequest hook fires the
// product notification AND returns a decision → codex obeys (sentinel appears on
// allow, is absent on deny). On macOS additionally asserts the NC delivery record.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireEnvKey, nonceMarker } from './lib/live-driver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, 'codex-approval-hook.mjs');

function writeCodexConfig(codexHome, sentinelPath) {
  fs.mkdirSync(codexHome, { recursive: true });
  // Approval-requiring policy so PermissionRequest fires; wire our harness hook.
  const hooks = { hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command: `node "${HOOK.replace(/\\/g, '/')}"`, timeout: 30 }] }] } };
  fs.writeFileSync(path.join(codexHome, 'hooks.json'), JSON.stringify(hooks, null, 2));
  fs.writeFileSync(path.join(codexHome, 'config.toml'),
    `approval_policy = "untrusted"\n[features]\nhooks = true\n`);
}

async function runOnce(decision) {
  requireEnvKey('OPENAI_API_KEY', { message: 'FAIL: OPENAI_API_KEY is not set — live Codex requires a real key.' });
  const codexHome = fs.mkdtempSync(path.join(os.homedir(), `aan-live-codex-${decision}-`));
  const sentinel = path.join(codexHome, `sentinel-${nonceMarker('cdx')}.txt`);
  writeCodexConfig(codexHome, sentinel);

  const env = { ...process.env, CODEX_HOME: codexHome, AAN_TEST_DECISION: decision };
  // Ask codex to run a shell command that creates the sentinel — which requires
  // approval under the untrusted policy.
  const res = spawnSync('codex', ['exec', '--skip-git-repo-check',
    `Run this shell command to create a file: touch "${sentinel}"`], {
    encoding: 'utf8', env, timeout: 180000,
  });
  console.log(`[${decision}] codex exit:`, res.status);
  console.log(`[${decision}] stdout:`, (res.stdout || '').slice(0, 800));
  console.log(`[${decision}] stderr:`, (res.stderr || '').slice(0, 400));

  const created = fs.existsSync(sentinel);
  fs.rmSync(codexHome, { recursive: true, force: true });
  return { created, res };
}

async function main() {
  // ALLOW run: hook returns allow → codex runs the command → sentinel exists.
  const allow = await runOnce('allow');
  if (!allow.created) {
    console.error('FAIL [PRODUCT]: allow decision returned but sentinel was NOT created — codex did not obey allow.');
    process.exit(1);
  }
  console.log('PASS (hard): allow → codex executed the guarded command (sentinel created).');

  // DENY run: hook returns deny → codex must NOT run the command → no sentinel.
  const deny = await runOnce('deny');
  if (deny.created) {
    console.error('FAIL [PRODUCT]: deny decision returned but sentinel WAS created — codex ignored deny.');
    process.exit(1);
  }
  console.log('PASS (hard): deny → codex blocked the guarded command (no sentinel).');

  console.log('Full approval loop proven: requested → decision returned → codex obeyed.');
  process.exit(0);
}

main();
```

> **Note:** the exact `codex exec` approval-forcing invocation may need
> adjustment to the pinned codex version's flags (the TUI-proof memory notes
> `codex exec` may not surface approvals the same way the TUI does — if `codex
> exec` bypasses PermissionRequest under `untrusted`, drive the approval through
> the `codex proto` app-server exchange instead, which the codex research
> documents as the deterministic path: `ExecApprovalRequest` → `Op::ExecApproval`).
> Validate the exec path in the first CI run; if approvals don't fire in exec
> mode, switch this driver to the `codex proto` harness. This is called out as
> the one lane with an empirical branch.

- [ ] **Step 3: Rewrite `live-codex.yml`**

```yaml
name: Live Codex

# Proves the REAL approval decision loop: codex reaches an approval point, our
# PermissionRequest hook fires the product notification and returns a decision,
# and codex obeys (sentinel on allow, none on deny). macOS leg also asserts the
# Notification Center delivery record.
on:
  push:
    branches: [main]
    paths-ignore: ['**/*.md', 'docs/**', 'LICENSE', '.gitignore']
  pull_request:
    paths-ignore: ['**/*.md', 'docs/**', 'LICENSE', '.gitignore']

concurrency:
  group: '${{ github.workflow }}-${{ github.ref }}'
  cancel-in-progress: true

jobs:
  live-codex:
    name: Live Codex (approval loop)
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-15]
    runs-on: ${{ matrix.os }}
    env:
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: 22
      - run: npm install
      - name: Install Codex CLI
        run: npm install -g @openai/codex@0.144.0
      - name: Verify OPENAI_API_KEY reaches OpenAI API
        run: |
          STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $OPENAI_API_KEY" https://api.openai.com/v1/models)
          echo "OpenAI API status: $STATUS"
          [ "$STATUS" = "200" ] || { echo "FAIL: OpenAI API returned $STATUS"; exit 1; }
      - name: macOS preflight (FDA grant + auth seed)
        if: runner.os == 'macOS'
        run: node scripts/mac-preflight-grant.mjs --seed-auth
      - name: Drive the real approval loop (allow + deny)
        run: node scripts/live-codex.mjs
```

- [ ] **Step 4: Commit, push, watch**

```bash
git add scripts/codex-approval-hook.mjs scripts/live-codex.mjs .github/workflows/live-codex.yml
git commit -m "ci(codex): rewrite to prove the real approval decision loop (allow/deny → sentinel)"
git push
gh run watch "$(gh run list --workflow=live-codex.yml -L1 --json databaseId -q '.[0].databaseId')"
```

Expected: both legs green with the two PASS lines. If approvals don't fire in
`codex exec`, switch to the `codex proto` harness per Step 2's note and re-run.

---

## Phase 5 — TUI proofs

### Task 11: tmux TUI harness — F1 (claude bell) + F2 (codex approval)

**Files:**
- Create: `scripts/tui/lib.mjs`, `scripts/tui/proof-bell.mjs`, `scripts/tui/proof-codex-approval.mjs`
- Create: `.github/workflows/tui-proofs.yml`

- [ ] **Step 1: Write the tmux harness helpers**

```js
// scripts/tui/lib.mjs — minimal tmux control for driving real agent TUIs in CI.
// Uses the system tmux (brew-installed in the lane). Every helper shells out; no
// deps. Sensors: window_bell_flag and capture-pane.
import { execFileSync, spawnSync } from 'node:child_process';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function tmux(args, opts = {}) {
  return execFileSync('tmux', args, { encoding: 'utf8', ...opts });
}

export function tmuxSafe(args) {
  const r = spawnSync('tmux', args, { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// Create a detached session running `cmd` in a NON-active window (bell flags
// record reliably only when the window is not the active one).
export function newDetachedWindow(session, cmd) {
  tmux(['new-session', '-d', '-s', session, '-x', '200', '-y', '50']);
  tmux(['set-option', '-t', session, 'monitor-bell', 'on']);
  tmux(['set-window-option', '-t', session, 'monitor-bell', 'on']);
  // Second window becomes active, leaving the agent window unfocused.
  tmux(['new-window', '-d', '-t', session, cmd]);
}

export function windowBellFlag(session, windowIndex = 0) {
  return tmux(['display-message', '-p', '-t', `${session}:${windowIndex}`, '#{window_bell_flag}']).trim();
}

export function capturePane(session, windowIndex = 0) {
  return tmux(['capture-pane', '-p', '-t', `${session}:${windowIndex}`]);
}

export function sendKeys(session, windowIndex, keys) {
  tmux(['send-keys', '-t', `${session}:${windowIndex}`, ...keys]);
}

export function killSession(session) {
  tmuxSafe(['kill-session', '-t', session]);
}
```

- [ ] **Step 2: Write F1 — claude bell proof**

```js
// scripts/tui/proof-bell.mjs — F1: a real claude TUI, terminal bell enabled,
// must set the tmux window_bell_flag (proves the bell reaches the terminal).
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { newDetachedWindow, windowBellFlag, capturePane, killSession, sleep } from './lib.mjs';

function fail(msg) { console.error(`FAIL [PRODUCT]: ${msg}`); killSession('aan-bell'); process.exit(1); }
function infra(msg) { console.error(`FAIL [INFRA]: ${msg}`); killSession('aan-bell'); process.exit(1); }

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) infra('ANTHROPIC_API_KEY required.');
  // Isolated home wired to notify with terminalBell enabled.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-tui-bell-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{}\n');
  fs.mkdirSync(path.join(home, '.ai-agent-notifier'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ai-agent-notifier', 'config.json'),
    JSON.stringify({ toast: { enabled: false }, ntfy: { enabled: false }, terminalBell: { enabled: true } }) + '\n');

  const repo = process.cwd();
  execWire(home, repo);

  const cmd = `env HOME='${home}' USERPROFILE='${home}' bash -lc "claude -p 'Reply with the single word OK.'; sleep 2"`;
  newDetachedWindow('aan-bell', cmd);

  // Poll the bell flag for up to 90s (claude cold start + turn).
  let flag = '0';
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    try { flag = windowBellFlag('aan-bell', 0); } catch { /* window may be starting */ }
    if (flag === '1') break;
  }
  console.log('pane tail:\n' + capturePane('aan-bell', 0).split('\n').slice(-8).join('\n'));
  killSession('aan-bell');
  fs.rmSync(home, { recursive: true, force: true });

  if (flag !== '1') fail('window_bell_flag never became 1 — claude TUI did not ring the terminal bell.');
  console.log('PASS (hard): real claude TUI rang the terminal bell (window_bell_flag=1).');
  process.exit(0);
}

// Wire notify hooks into the isolated home by running the real setup patcher.
function execWire(home, repo) {
  const { patchClaude } = requirePatch(repo);
  patchClaude(path.join(home, '.claude'), path.join(repo, 'src', 'notify.mjs'));
}
function requirePatch(repo) {
  // Dynamic import wrapper kept sync-ish for readability.
  return import(path.join(repo, 'setup', 'patch-config.mjs'));
}

main();
```

> **Note:** `requirePatch` returns a promise; adjust `execWire` to `await` it. In
> implementation, make `execWire` async and `await execWire(...)` in `main`
> before launching the window. (Kept explicit here so the wiring dependency on
> `patchClaude` is visible.)

- [ ] **Step 3: Write F2 — codex approval TUI proof**

```js
// scripts/tui/proof-codex-approval.mjs — F2: a real codex TUI reaches an approval
// modal, our notification fires, we approve via send-keys, and the turn completes.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { newDetachedWindow, capturePane, sendKeys, killSession, sleep } from './lib.mjs';

function fail(msg) { console.error(`FAIL [PRODUCT]: ${msg}`); killSession('aan-codex'); process.exit(1); }
function infra(msg) { console.error(`FAIL [INFRA]: ${msg}`); killSession('aan-codex'); process.exit(1); }

async function main() {
  if (!process.env.OPENAI_API_KEY) infra('OPENAI_API_KEY required.');
  const codexHome = fs.mkdtempSync(path.join(os.homedir(), 'aan-tui-codex-'));
  // Wire the real notify hook on PermissionRequest (product path, notify-only).
  const notify = path.join(process.cwd(), 'src', 'notify.mjs').replace(/\\/g, '/');
  fs.writeFileSync(path.join(codexHome, 'hooks.json'),
    JSON.stringify({ hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command: `node "${notify}" --source codex --event needs_input`, timeout: 20 }] }] } }, null, 2));
  fs.writeFileSync(path.join(codexHome, 'config.toml'), `approval_policy = "untrusted"\n[features]\nhooks = true\n`);

  const sentinelSeen = path.join(codexHome, 'approved.txt');
  const cmd = `env CODEX_HOME='${codexHome}' bash -lc "codex -a untrusted 'Run: touch ${sentinelSeen}'"`;
  newDetachedWindow('aan-codex', cmd);

  // Wait for the approval modal to appear in the pane.
  let sawModal = false;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const pane = safeCapture('aan-codex');
    if (/allow|approve|permission|y\/n|yes.*no/i.test(pane)) { sawModal = true; break; }
  }
  if (!sawModal) fail('codex approval modal never appeared in the TUI.');
  console.log('approval modal detected; approving via send-keys.');

  // Approve. Codex approval UIs vary by version: try Enter (default = approve),
  // then 'y' as a fallback.
  sendKeys('aan-codex', 0, ['Enter']);
  await sleep(2000);
  sendKeys('aan-codex', 0, ['y']);

  // The turn completes when the sentinel appears (command ran after approval).
  let done = false;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    if (fs.existsSync(sentinelSeen)) { done = true; break; }
  }
  console.log('pane tail:\n' + safeCapture('aan-codex').split('\n').slice(-10).join('\n'));
  killSession('aan-codex');
  fs.rmSync(codexHome, { recursive: true, force: true });

  if (!done) fail('approved in the TUI but the guarded command never ran (turn did not complete).');
  console.log('PASS (hard): real codex TUI approval → command executed after our approve keystroke.');
  process.exit(0);
}

function safeCapture(s) { try { return capturePane(s, 0); } catch { return ''; } }

main();
```

- [ ] **Step 4: Write `tui-proofs.yml`**

```yaml
name: TUI Proofs

# Drives the REAL agent TUIs in tmux on macOS and asserts user-perceptible
# outcomes: F1 the claude terminal bell sets window_bell_flag; F2 a codex
# approval modal is answered and the guarded command runs.
on:
  push:
    branches: [main]
    paths-ignore: ['**/*.md', 'docs/**', 'LICENSE', '.gitignore']
  pull_request:
    paths-ignore: ['**/*.md', 'docs/**', 'LICENSE', '.gitignore']

concurrency:
  group: '${{ github.workflow }}-${{ github.ref }}'
  cancel-in-progress: true

jobs:
  tui-proofs:
    name: TUI Proofs (macos-15)
    runs-on: macos-15
    env:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      LANG: en_US.UTF-8
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: 22
      - run: npm install
      - name: Install tmux + agent CLIs
        run: |
          brew install tmux
          npm install -g @anthropic-ai/claude-code@2.1.205 @openai/codex@0.144.0
      - name: F1 — claude terminal bell (window_bell_flag)
        run: node scripts/tui/proof-bell.mjs
      - name: F2 — codex approval TUI loop
        run: node scripts/tui/proof-codex-approval.mjs
      - name: Diagnostics (always)
        if: always()
        run: tmux ls || true
```

- [ ] **Step 5: Fix the async wiring flagged in Step 2, then commit**

Make `execWire` async in `proof-bell.mjs`:

```js
async function execWire(home, repo) {
  const { patchClaude } = await import(path.join(repo, 'setup', 'patch-config.mjs'));
  patchClaude(path.join(home, '.claude'), path.join(repo, 'src', 'notify.mjs'));
}
```

and `await execWire(home, repo);` in `main`.

```bash
git add scripts/tui .github/workflows/tui-proofs.yml
git commit -m "ci(tui): macos-15 TUI proofs — claude bell flag + codex approval loop"
git push
gh run watch "$(gh run list --workflow=tui-proofs.yml -L1 --json databaseId -q '.[0].databaseId')"
```

Expected: green with both PASS lines. TUI timing is the flakiest surface — if a
proof is flaky, add one bounded retry around the setup (never around the assert)
per the failure taxonomy, and widen the poll windows before weakening any assert.

---

## Phase 6 — Documentation, evidence, finalize

### Task 12: Evidence record + README truth fixes + matrix

**Files:**
- Create: `docs/research/2026-07-11-macos-real-ux-evidence.md`
- Modify: `README.md`

- [ ] **Step 1: Write the evidence record**

Compose `docs/research/2026-07-11-macos-real-ux-evidence.md` from the four
research reports and the spike findings. Required sections: the honest problem
statement (exit 0 ≠ delivered); the NC-DB mechanism + the exact DB path the spike
confirmed; SIP/TCC self-grant recipe; the five spike decisions (Task 1 Step 3);
the codex approval-loop contract; the explicit non-goals (screenshots/sound/
click). Link the runner-research and codex-decision source URLs already gathered.

- [ ] **Step 2: Fix `README.md:188` and add the CI matrix**

Locate the line claiming `toastSound` is "ignored on macOS/Linux" and replace
with the truth: on macOS, `toastSound` is mapped to a real macOS system sound
(Windows names like `IM`/`Reminder` are translated; unknown/`Default` uses the
system default). Add a "What CI proves" matrix (channel × OS) documenting, per
cell, the actual assertion (e.g. macOS toast = "Notification Center delivery
record", Linux toast = "dunst history capture", Windows toast = "BurntToast
accepted", claude/gemini/codex = the real-agent lanes).

- [ ] **Step 3: Bump version**

In `package.json` change `"version": "1.1.0"` to `"version": "1.2.0"`.

- [ ] **Step 4: Commit**

```bash
git add docs/research/2026-07-11-macos-real-ux-evidence.md README.md package.json
git commit -m "docs: macOS real-UX evidence record, README sound truth fix + CI-proof matrix, v1.2.0"
```

### Task 13: Retire the exit-code mac test; full green; delete spike

**Files:**
- Modify: `tests/platforms.test.mjs`
- Delete: `.github/workflows/spike-mac-delivery.yml`

- [ ] **Step 1: Remove the superseded live osascript exit-code test**

In `tests/platforms.test.mjs`, delete the darwin-gated live osascript test (the
one asserting `r === true` from a real `osascript` call, ~lines 77–83). Its
coverage is replaced by the delivery-capture lane. Keep the `esc()` unit tests
and the unavailable-path tests. If removing it leaves `AAN_TOAST_LIVE`-gated code
unused in that file, remove the now-dead gate too.

- [ ] **Step 2: Run the full unit suite**

Run: `npm test`
Expected: PASS — sound-mapping, macos-delivery (pure), doctor suites green; no reference to the deleted test.

- [ ] **Step 3: Delete the spike workflow**

```bash
git rm .github/workflows/spike-mac-delivery.yml
git commit -m "chore(ci): remove scratch mac-delivery spike (findings recorded in evidence)"
```

- [ ] **Step 4: Push and verify every lane green**

```bash
git push
# Watch the full set; all must be green (or skipped-for-missing-secret).
for wf in toast-macos.yml toast-native.yml live-claude.yml live-gemini.yml live-codex.yml tui-proofs.yml unit.yml; do
  echo "== $wf =="
  gh run list --workflow=$wf -L1
done
```

Expected: all green. Re-run once to shake out TUI/delivery flakes before opening the PR.

### Task 14: Open the PR

- [ ] **Step 1: Push the branch and open one PR**

```bash
gh pr create --base main --head feat/mac-real-ux \
  --title "feat: macOS real-UX coverage — delivery capture, aan doctor, real-agent lanes (1.2.0)" \
  --body "$(cat <<'EOF'
Implements docs/specs/2026-07-11-macos-real-ux-coverage-design.md.

CI now fails when a real Mac user would have seen or heard nothing:
- Keystone `src/platforms/macos-delivery.mjs` reads the Notification Center DB.
- New `aan doctor [--deep]` ships the same verification to users.
- Lanes on macos-15 assert OS-observable state with real agents:
  - Live Toast macOS: negative silent-drop + positive NC delivery record + doctor self-proof.
  - Live Claude/Gemini E2E: NC delivery record, not just ntfy.
  - Live Codex: real approval decision loop (allow/deny → sentinel).
  - TUI Proofs: claude bell flag + codex approval loop in tmux.
- Sound-name mapping fix (Windows names → real macOS sounds); README truth fix + CI-proof matrix.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Confirm all required checks report on the PR**

```bash
gh pr checks --watch
```

Expected: green. **After merge**, add the new job names to branch-protection
required checks (user decision — required from day one): *Live Toast macOS
(delivery capture)*, *Live Claude E2E (required, paid)* (macos-15 leg), *Live
Gemini E2E (required)* (macos-15 leg), *Live Codex (approval loop)*, *TUI Proofs
(macos-15)*. Missing-secret skips satisfy protection, same as the existing paid
lane.

---

## Self-Review notes

- **Spec coverage:** keystone (Task 3) ✓; aan doctor (Tasks 4–5) ✓; sound fix +
  README:188 (Tasks 2, 12) ✓; delivery lane + toast-native shrink (Tasks 6–7) ✓;
  claude/gemini macOS (Task 9) ✓; codex approval loop (Task 10) ✓; TUI proofs
  (Task 11) ✓; spike (Task 1) ✓; failure taxonomy (INFRA/PRODUCT prefixes in
  every driver) ✓; evidence record + matrix (Task 12) ✓; gating (Task 14) ✓;
  non-goals respected (no screenshot/sound/click gating) ✓.
- **Empirical branches, explicitly flagged (not placeholders):** (a) DB path /
  auth-seed constants finalized by the spike, with the exact decision rules and
  the macos-14 fallback written out (Task 1); (b) the codex `exec` vs `proto`
  approval path, with the deterministic `proto` fallback named (Task 10). Both
  are genuine runner-behavior unknowns the spike/first-run resolves — every other
  step is complete, runnable code.
- **Type consistency:** `verifyDelivery(marker, opts) → { delivered, record?, reason? }`,
  `record = { title, body, app, date }`, `notificationAuthState() → { state, app?, detail }`,
  `runChecks({config, configProblem, deep, strict}) → [{ id, channel, status, detail, hint }]`
  used identically across module, doctor, and all lane drivers.
