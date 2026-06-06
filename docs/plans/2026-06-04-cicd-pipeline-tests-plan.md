# CI/CD Pipeline Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-platform GitHub Actions pipeline that verifies the `ai-agent-notifier` CLI works for real on Linux, macOS, and Windows — installing the actual AI agents, patching their real configs, smoke-loading them, and exercising notification delivery without mocking.

**Architecture:** Two tiers. Tier 1 (no secrets, blocking) runs the existing unit suite cross-OS, installs the real agent CLIs, runs the real `setup` subprocess against an isolated temp HOME, smoke-loads each patched CLI (with a negative control), and verifies real ntfy.sh delivery + real `notify.mjs` invocation. Tier 2 (secret-gated, non-blocking) drives Gemini (free tier) and optionally Claude end-to-end. New real-world tests live in `tests/e2e/` (run via `npm run test:e2e`); the existing offline suite (`npm test`) is unchanged. A dependency-free smoke-load harness (`scripts/smoke-load.mjs`) is unit-tested offline with a fixture CLI and run against real CLIs in the workflow.

**Tech Stack:** Node.js built-in test runner (`node --test`), Node 22 in CI, GitHub Actions, ntfy.sh (public, no auth), the agent CLIs (`@anthropic-ai/claude-code`, `@google/gemini-cli`, `@openai/codex`, best-effort `cursor-agent`).

---

## Relationship to existing tests (do NOT duplicate)

`tests/patch-config.test.mjs` and `tests/patch-config-advanced.test.mjs` already
cover, via direct `patchX()` calls: Claude/Codex/Cursor/Gemini schemas, Codex
trust hashes + `[features] hooks=true` + `codex_hooks` migration, idempotency,
`[hooks.state]` duplicate-key repair, Windows path normalization, corrupt
configs, and `unpatchAll`. `tests/notify-unit.test.mjs` covers `parseArgs` and
the dedup-lock logic. `tests/integration.test.mjs` covers the
`parseInput → route → buildNtfyRequest` pipeline (object construction only — it
never sends).

**This plan adds only the layers those tests cannot reach:** real subprocess
execution, real network delivery, real CLI installs, real config-load smoke
tests, and cross-OS CI execution.

## File structure

| File | Responsibility |
|---|---|
| `package.json` | Add `test:e2e` script (modify) |
| `tests/e2e/helpers.mjs` | Shared e2e helpers: temp HOME, config writer, node runner, ntfy poll, lock clear (create) |
| `tests/e2e/helpers.test.mjs` | Unit tests for the pure helpers (create) |
| `tests/e2e/ntfy-roundtrip.e2e.test.mjs` | Real `test ntfy` → poll ntfy.sh → assert delivery (create) |
| `tests/e2e/hook-invocation.e2e.test.mjs` | Real `notify.mjs` subprocess per source → assert delivery (create) |
| `tests/e2e/setup.e2e.test.mjs` | Real `setup` subprocess → assert patched files, idempotency, uninstall (create) |
| `scripts/smoke-load.mjs` | Dependency-free smoke-load harness + pure classifier (create) |
| `tests/fixtures/fake-cli.mjs` | Fixture CLI for offline smoke-load tests (create) |
| `tests/smoke-load.test.mjs` | Offline unit tests for the smoke-load harness (create) |
| `scripts/live-gemini.mjs` | Tier 2: drive Gemini end-to-end (create) |
| `scripts/live-claude.mjs` | Tier 2: drive Claude end-to-end (create) |
| `.github/workflows/ci.yml` | The pipeline: all jobs (create) |
| `README.md` | CI badge + Testing section (modify) |

---

## Task 1: Add the `test:e2e` npm script

**Files:**
- Modify: `package.json:10-12`

- [ ] **Step 1: Add the script**

In `package.json`, change the `scripts` block from:

```json
  "scripts": {
    "test": "node --test tests/*.test.mjs"
  },
```

to:

```json
  "scripts": {
    "test": "node --test tests/*.test.mjs",
    "test:e2e": "node --test tests/e2e/*.test.mjs"
  },
```

(`npm test` globs only direct children of `tests/`, so the new `tests/e2e/`
suites are excluded from the fast offline gate and run only via `npm run
test:e2e`.)

- [ ] **Step 2: Verify the existing suite still passes**

Run: `npm test`
Expected: `pass 83`, `fail 0`.

(`npm run test:e2e` is exercised in Task 2 once `tests/e2e/` exists. With no e2e
files present yet, the runner may report "no test files found" — that is fine and
expected at this point.)

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "build: add test:e2e npm script for real-world e2e suites"
```

---

## Task 2: e2e helpers module

**Files:**
- Create: `tests/e2e/helpers.mjs`
- Create: `tests/e2e/helpers.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/helpers.test.mjs`:

```js
// tests/e2e/helpers.test.mjs — unit tests for the pure e2e helpers
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomTopic, parseNtfyMessages, seedTempHome, writeUserConfig } from './helpers.mjs';

describe('randomTopic', () => {
  it('uses the prefix and is unguessable/unique', () => {
    const a = randomTopic();
    const b = randomTopic();
    assert.match(a, /^aan-ci-[a-z0-9]{16}$/);
    assert.notEqual(a, b);
  });
  it('honors a custom prefix', () => {
    assert.match(randomTopic('hook'), /^hook-[a-z0-9]{16}$/);
  });
});

describe('parseNtfyMessages', () => {
  it('returns only event=message entries, parsed', () => {
    const stream = [
      JSON.stringify({ id: '1', event: 'open', topic: 't' }),
      JSON.stringify({ id: '2', event: 'message', topic: 't', title: 'Hi', message: 'yo' }),
      '',
      JSON.stringify({ id: '3', event: 'keepalive', topic: 't' }),
    ].join('\n');
    const msgs = parseNtfyMessages(stream);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].title, 'Hi');
    assert.equal(msgs[0].message, 'yo');
  });
  it('tolerates blank/garbage lines', () => {
    assert.deepEqual(parseNtfyMessages('\n  \nnot json\n'), []);
  });
});

describe('seedTempHome + writeUserConfig', () => {
  it('creates the four tool dirs so detectTools() finds them', () => {
    const home = seedTempHome();
    try {
      assert.ok(fs.existsSync(path.join(home, '.claude', 'settings.json')));
      assert.ok(fs.existsSync(path.join(home, '.codex')));
      assert.ok(fs.existsSync(path.join(home, '.cursor')));
      assert.ok(fs.existsSync(path.join(home, '.gemini')));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
  it('writes a user config that loadConfig can merge', () => {
    const home = seedTempHome();
    try {
      writeUserConfig(home, { ntfy: { topic: 'xyz' } });
      const cfg = JSON.parse(fs.readFileSync(path.join(home, '.ai-agent-notifier', 'config.json'), 'utf8'));
      assert.equal(cfg.ntfy.topic, 'xyz');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — `Cannot find module './helpers.mjs'`.

- [ ] **Step 3: Implement the helpers**

Create `tests/e2e/helpers.mjs`:

```js
// tests/e2e/helpers.mjs — shared helpers for real-world e2e tests.
// No mocking: these spawn the real CLI, write real files, and hit real ntfy.sh.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, '..', '..');

let counter = 0;
function uniqueSuffix() {
  // Avoid Date.now()/Math.random() collisions across fast calls.
  counter += 1;
  return `${process.pid}-${counter}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function randomTopic(prefix = 'aan-ci') {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
}

// Parse ntfy's newline-delimited JSON stream, returning only delivered messages.
export function parseNtfyMessages(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      if (obj && obj.event === 'message') out.push(obj);
    } catch { /* ignore non-JSON lines */ }
  }
  return out;
}

// Create an isolated HOME seeded so setup's detectTools() finds all four tools.
export function seedTempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `aan-home-${uniqueSuffix()}-`));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{}\n');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
  return home;
}

// Write ~/.ai-agent-notifier/config.json (merged over defaults by loadConfig).
export function writeUserConfig(home, partial) {
  const dir = path.join(home, '.ai-agent-notifier');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(partial, null, 2) + '\n');
}

// Remove a dedup lock so the same source can fire twice within 10s.
export function clearLock(home, source) {
  try { fs.unlinkSync(path.join(home, '.ai-agent-notifier', `.lock-${source}`)); } catch { /* none */ }
}

// Run a node script from the repo with an isolated HOME. Returns {status, stdout, stderr}.
export function runNode(args, { home, stdin = '', extraEnv = {}, timeout = 120000 } = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...extraEnv };
  const res = spawnSync(process.execPath, args, {
    cwd: repoRoot, input: stdin, env, encoding: 'utf8', timeout,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

// Poll ntfy for a message matching `match`. Returns the message or null.
export function ntfyPoll({ server = 'https://ntfy.sh', topic, match, attempts = 12, delayMs = 1500 }) {
  const url = `${server.replace(/\/+$/, '')}/${topic}/json?poll=1`;
  const transport = url.startsWith('https:') ? https : http;
  const getOnce = () => new Promise((resolve) => {
    const req = transport.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
  });
  return (async () => {
    for (let i = 0; i < attempts; i++) {
      const body = await getOnce();
      const hit = parseNtfyMessages(body).find(match);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
  })();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:e2e`
Expected: PASS — `randomTopic`, `parseNtfyMessages`, `seedTempHome + writeUserConfig` all green.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/helpers.mjs tests/e2e/helpers.test.mjs
git commit -m "test(e2e): add shared helpers for real-world e2e suites"
```

---

## Task 3: Real ntfy.sh round-trip test

**Files:**
- Create: `tests/e2e/ntfy-roundtrip.e2e.test.mjs`

This exercises the real `sendNtfy` HTTP POST (never tested before) by running the
shipping `ai-agent-notifier test ntfy` command and reading the message back from
ntfy.sh.

- [ ] **Step 1: Write the test**

Create `tests/e2e/ntfy-roundtrip.e2e.test.mjs`:

```js
// tests/e2e/ntfy-roundtrip.e2e.test.mjs — real HTTP delivery to ntfy.sh
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { seedTempHome, writeUserConfig, runNode, ntfyPoll, randomTopic } from './helpers.mjs';

describe('ntfy round-trip via `test ntfy`', () => {
  const home = seedTempHome();
  after(() => fs.rmSync(home, { recursive: true, force: true }));

  it('delivers a real push that we can read back from ntfy.sh', async () => {
    const topic = randomTopic();
    writeUserConfig(home, { ntfy: { enabled: true, server: 'https://ntfy.sh', topic } });

    const res = runNode(['cli/index.mjs', 'test', 'ntfy'], { home });
    assert.equal(res.status, 0, `test ntfy exited non-zero: ${res.stderr}`);

    const msg = await ntfyPoll({
      topic,
      match: (m) => m.title === 'ai-agent-notifier' && /Test notification/.test(m.message || ''),
    });
    assert.ok(msg, 'expected the test notification to arrive at ntfy.sh');
    assert.equal(msg.title, 'ai-agent-notifier');
  });
});
```

- [ ] **Step 2: Run it to verify it passes (requires network)**

Run: `npm run test:e2e`
Expected: PASS. If it fails with a null message, ntfy.sh may be slow — the poll retries 12×1.5s. Re-run once before investigating.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/ntfy-roundtrip.e2e.test.mjs
git commit -m "test(e2e): real ntfy.sh round-trip via `test ntfy`"
```

---

## Task 4: Real `notify.mjs` hook-invocation test

**Files:**
- Create: `tests/e2e/hook-invocation.e2e.test.mjs`

Spawns the real `src/notify.mjs` exactly as each agent's hook would, feeding the
byte-exact stdin each agent sends, and asserts a real ntfy push lands.

- [ ] **Step 1: Write the test**

Create `tests/e2e/hook-invocation.e2e.test.mjs`:

```js
// tests/e2e/hook-invocation.e2e.test.mjs — real notify.mjs subprocess per source
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { seedTempHome, writeUserConfig, runNode, ntfyPoll, randomTopic } from './helpers.mjs';

// Each entry mirrors how setup/patch-config.mjs wires the hook for that agent.
const CASES = [
  { source: 'claude', args: [], stdin: { hook_event_name: 'Stop', session_id: 'x' }, title: 'Claude Code' },
  { source: 'gemini', args: [], stdin: { hook_event_name: 'AfterAgent', session_id: 'x' }, title: 'Gemini' },
  { source: 'codex', args: ['--event', 'Stop'], stdin: { session_id: 'x' }, title: 'Codex' },
  { source: 'cursor', args: ['--event', 'stop'], stdin: { status: 'completed', loop_count: 0 }, title: 'Cursor' },
];

describe('hook invocation: real notify.mjs → real ntfy push', () => {
  const homes = [];
  after(() => homes.forEach((h) => fs.rmSync(h, { recursive: true, force: true })));

  for (const c of CASES) {
    it(`${c.source} stop event delivers a notification`, async () => {
      const home = seedTempHome();
      homes.push(home);
      const topic = randomTopic(`hook-${c.source}`);
      // Disable toast so headless runners only exercise the ntfy path.
      writeUserConfig(home, { toast: { enabled: false }, ntfy: { enabled: true, server: 'https://ntfy.sh', topic } });

      const proj = `proj-${c.source}`;
      const stdin = JSON.stringify({ ...c.stdin, cwd: `/work/${proj}` });
      const res = runNode(['src/notify.mjs', '--source', c.source, ...c.args], { home, stdin });
      assert.equal(res.status, 0, `notify.mjs exited non-zero: ${res.stderr}`);

      const msg = await ntfyPoll({ topic, match: (m) => m.title === c.title });
      assert.ok(msg, `expected an ntfy push for ${c.source}`);
      assert.match(msg.message, /Task complete/);
    });
  }

  it('does not throw when toast is enabled but no backend exists', () => {
    const home = seedTempHome();
    homes.push(home);
    // toast enabled (default), ntfy disabled — proves graceful handling on headless runners.
    writeUserConfig(home, { ntfy: { enabled: false } });
    const stdin = JSON.stringify({ hook_event_name: 'Stop', cwd: '/work/x', session_id: 'x' });
    const res = runNode(['src/notify.mjs', '--source', 'claude'], { home, stdin });
    assert.equal(res.status, 0, `notify.mjs should exit 0 even with no toast backend: ${res.stderr}`);
  });
});
```

- [ ] **Step 2: Run it to verify it passes (requires network)**

Run: `npm run test:e2e`
Expected: PASS — four delivery cases + the graceful-toast case. Each source uses its own HOME and topic, so the dedup lock never collides.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/hook-invocation.e2e.test.mjs
git commit -m "test(e2e): real notify.mjs hook invocation → ntfy delivery per source"
```

---

## Task 5: Real `setup` subprocess test

**Files:**
- Create: `tests/e2e/setup.e2e.test.mjs`

Runs the real `ai-agent-notifier setup` binary against an isolated temp HOME with
piped answers — exercising `detectTools()`, notifyPath resolution, config save,
and all four patchers together (the integration layer the unit tests skip).

- [ ] **Step 1: Write the test**

Create `tests/e2e/setup.e2e.test.mjs`:

```js
// tests/e2e/setup.e2e.test.mjs — real `setup` and `uninstall` subprocesses
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { seedTempHome, runNode, randomTopic } from './helpers.mjs';

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

describe('real setup subprocess wires every detected tool', () => {
  const home = seedTempHome();
  const topic = randomTopic('setup');
  after(() => fs.rmSync(home, { recursive: true, force: true }));

  // setup prompts: enable ntfy? -> server -> topic
  const answers = ['y', 'https://ntfy.sh', topic].join('\n') + '\n';

  it('patches Claude, Codex, Cursor, and Gemini and saves the topic', () => {
    const res = runNode(['cli/index.mjs', 'setup'], { home, stdin: answers });
    assert.equal(res.status, 0, `setup exited non-zero: ${res.stderr}`);

    // Config saved with our topic
    const cfg = readJSON(path.join(home, '.ai-agent-notifier', 'config.json'));
    assert.equal(cfg.ntfy.topic, topic);

    // Claude
    const claude = readJSON(path.join(home, '.claude', 'settings.json'));
    assert.ok(claude.hooks.Stop?.length, 'claude Stop hook');
    assert.ok(claude.hooks.Notification?.length, 'claude Notification hook');

    // Codex
    const codex = readJSON(path.join(home, '.codex', 'hooks.json'));
    assert.ok(codex.hooks.Stop?.length, 'codex Stop hook');
    assert.ok(codex.hooks.SessionStart?.length, 'codex SessionStart hook');
    const toml = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    assert.match(toml, /hooks = true/);
    assert.match(toml, /trusted_hash = "sha256:/);

    // Cursor
    const cursor = readJSON(path.join(home, '.cursor', 'hooks.json'));
    assert.equal(cursor.version, 1);
    assert.match(cursor.hooks.stop[0].command, /notify\.mjs/);

    // Gemini
    const gemini = readJSON(path.join(home, '.gemini', 'settings.json'));
    assert.ok(gemini.hooks.AfterAgent?.length, 'gemini AfterAgent hook');
    assert.ok(gemini.hooks.Notification?.length, 'gemini Notification hook');
  });

  it('is idempotent at the subprocess level (re-run adds no duplicates)', () => {
    const res = runNode(['cli/index.mjs', 'setup'], { home, stdin: answers });
    assert.equal(res.status, 0, `second setup exited non-zero: ${res.stderr}`);

    const claude = readJSON(path.join(home, '.claude', 'settings.json'));
    const managed = claude.hooks.Notification.filter(
      (h) => h.hooks?.some((hh) => /notify\.mjs/.test(hh.command || ''))
    );
    assert.equal(managed.length, 1, 'exactly one managed Claude Notification hook');

    // Codex config.toml must remain valid (no duplicate hooks.state keys)
    const toml = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    const keys = [...toml.matchAll(/^\[hooks\.state\.'([^']+)'\]$/gm)].map((m) => m[1]);
    assert.equal(keys.length, new Set(keys).size, 'no duplicate [hooks.state] keys');
  });

  it('uninstall removes the managed hooks', () => {
    const res = runNode(['cli/index.mjs', 'uninstall'], { home, stdin: 'y\n' });
    assert.equal(res.status, 0, `uninstall exited non-zero: ${res.stderr}`);
    const claude = readJSON(path.join(home, '.claude', 'settings.json'));
    assert.equal(claude.hooks.Stop, undefined, 'claude Stop removed');
    assert.equal(claude.hooks.Notification, undefined, 'claude Notification removed');
  });
});
```

- [ ] **Step 2: Run it to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — the three ordered tests (patch, idempotency, uninstall). Note: on Windows, setup attempts a BurntToast install via `pwsh` (best-effort, wrapped in try/catch); it may add time but must not fail setup. The 120s subprocess timeout covers it.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/setup.e2e.test.mjs
git commit -m "test(e2e): real setup/uninstall subprocess against isolated HOME"
```

---

## Task 6: Smoke-load harness + fixture + offline unit tests

**Files:**
- Create: `tests/fixtures/fake-cli.mjs`
- Create: `scripts/smoke-load.mjs`
- Create: `tests/smoke-load.test.mjs`

The harness launches a real CLI twice — once against a **valid** patched config,
once against a **deliberately corrupt** config — and classifies the result. The
negative control proves the probe actually parses config (otherwise the check is
vacuous). Pure functions are unit-tested offline with a fixture CLI; the real
CLIs are driven from the workflow (Task 7).

- [ ] **Step 1: Create the fixture CLI**

Create `tests/fixtures/fake-cli.mjs`:

```js
#!/usr/bin/env node
// Fixture CLI for smoke-load harness tests.
// Reads the config file named by FAKE_CLI_CONFIG.
//  - If FAKE_CLI_IGNORE_CONFIG=1, it never reads config (simulates a probe that
//    does not parse config -> "launch-only").
//  - Else if the config contains "BREAK", it simulates a parse failure.
import fs from 'node:fs';

if (process.env.FAKE_CLI_IGNORE_CONFIG === '1') {
  process.stdout.write('fake-cli 1.0.0\n');
  process.exit(0);
}
let body = '';
try { body = fs.readFileSync(process.env.FAKE_CLI_CONFIG || '', 'utf8'); } catch { /* missing */ }
if (body.includes('BREAK')) {
  process.stderr.write('error: failed to parse config: duplicate key\n');
  process.exit(1);
}
process.stdout.write('fake-cli 1.0.0\n');
process.exit(0);
```

- [ ] **Step 2: Write the failing test**

Create `tests/smoke-load.test.mjs`:

```js
// tests/smoke-load.test.mjs — offline unit tests for the smoke-load harness
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hasConfigError, classifySmoke } from '../scripts/smoke-load.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(__dirname, 'fixtures', 'fake-cli.mjs');
const PATTERNS = ['failed to parse', 'duplicate key', 'invalid config', 'syntax error'];

describe('hasConfigError', () => {
  it('matches known config-error patterns case-insensitively', () => {
    assert.equal(hasConfigError('Error: Failed To Parse config', PATTERNS), true);
    assert.equal(hasConfigError('fake-cli 1.0.0', PATTERNS), false);
  });
});

describe('classifySmoke', () => {
  it('fail when the valid-config run errors', () => {
    const pos = { status: 1, stdout: '', stderr: 'failed to parse' };
    const neg = { status: 1, stdout: '', stderr: 'failed to parse' };
    assert.equal(classifySmoke(pos, neg, PATTERNS), 'fail');
  });
  it('verified when valid is clean and corrupt errors', () => {
    const pos = { status: 0, stdout: 'ok', stderr: '' };
    const neg = { status: 1, stdout: '', stderr: 'duplicate key' };
    assert.equal(classifySmoke(pos, neg, PATTERNS), 'verified');
  });
  it('launch-only when corrupt also passes', () => {
    const pos = { status: 0, stdout: 'ok', stderr: '' };
    const neg = { status: 0, stdout: 'ok', stderr: '' };
    assert.equal(classifySmoke(pos, neg, PATTERNS), 'launch-only');
  });
});

describe('end-to-end against the fixture CLI', () => {
  const run = (configBody, env = {}) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-fix-'));
    const cfg = path.join(home, 'cfg');
    fs.writeFileSync(cfg, configBody);
    const res = spawnSync(process.execPath, [FAKE], {
      encoding: 'utf8', env: { ...process.env, FAKE_CLI_CONFIG: cfg, ...env },
    });
    fs.rmSync(home, { recursive: true, force: true });
    return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
  };

  it('classifies a config-reading CLI as verified', () => {
    const pos = run('valid config');
    const neg = run('BREAK');
    assert.equal(classifySmoke(pos, neg, PATTERNS), 'verified');
  });

  it('classifies a config-ignoring CLI as launch-only', () => {
    const pos = run('valid config', { FAKE_CLI_IGNORE_CONFIG: '1' });
    const neg = run('BREAK', { FAKE_CLI_IGNORE_CONFIG: '1' });
    assert.equal(classifySmoke(pos, neg, PATTERNS), 'launch-only');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test tests/smoke-load.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/smoke-load.mjs'`.

- [ ] **Step 4: Implement the harness**

Create `scripts/smoke-load.mjs`:

```js
// scripts/smoke-load.mjs — launch a real agent CLI against a valid vs corrupt
// config and classify whether it loads our patched config cleanly.
//
// Usage: node scripts/smoke-load.mjs --cli <claude|codex|gemini|cursor> [--require-verified]
// Exit 0 on 'verified' or 'launch-only' (or SKIP when the CLI is absent);
// exit 1 on 'fail', or on non-'verified' when --require-verified is set.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patchClaude, patchCodex, patchCursor, patchGemini } from '../setup/patch-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const NOTIFY = path.join(repoRoot, 'src', 'notify.mjs');

export function hasConfigError(text, patterns) {
  const t = String(text || '').toLowerCase();
  return patterns.some((p) => t.includes(p.toLowerCase()));
}

// 'fail'        valid-config run errored (real breakage)
// 'verified'    valid clean AND corrupt errored (probe truly parses config)
// 'launch-only' valid clean BUT corrupt also clean (only proved the CLI launches)
export function classifySmoke(positive, negative, patterns) {
  const posClean = positive.status === 0 && !hasConfigError(positive.stderr + positive.stdout, patterns);
  if (!posClean) return 'fail';
  const negErrored = negative.status !== 0 || hasConfigError(negative.stderr + negative.stdout, patterns);
  return negErrored ? 'verified' : 'launch-only';
}

const PATTERNS = ['failed to parse', 'duplicate key', 'invalid config', 'syntax error', 'could not parse', 'unexpected'];

const CLIS = {
  claude: { bin: 'claude', args: ['--version'], dir: '.claude', patch: patchClaude,
    corrupt: (home) => fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{ BREAK not json') },
  codex: { bin: 'codex', args: ['--version'], dir: '.codex', patch: patchCodex,
    corrupt: (home) => fs.writeFileSync(path.join(home, '.codex', 'config.toml'),
      "[hooks.state.'a']\nx = 1\n[hooks.state.'a']\nx = 2\n# BREAK duplicate key\n") },
  gemini: { bin: 'gemini', args: ['--version'], dir: '.gemini', patch: patchGemini,
    corrupt: (home) => fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), '{ BREAK not json') },
  cursor: { bin: 'cursor-agent', args: ['--version'], dir: '.cursor', patch: patchCursor,
    corrupt: (home) => fs.writeFileSync(path.join(home, '.cursor', 'hooks.json'), '{ BREAK not json') },
};

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aan-smoke-'));
}

function runCli(spec, home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const res = spawnSync(spec.bin, spec.args, { encoding: 'utf8', env, timeout: 60000 });
  return res; // res.error set (ENOENT) if the binary is missing
}

function main() {
  const argv = process.argv.slice(2);
  const cli = argv[argv.indexOf('--cli') + 1];
  const requireVerified = argv.includes('--require-verified');
  const spec = CLIS[cli];
  if (!spec) { console.error(`Unknown --cli "${cli}"`); process.exit(2); }

  // Positive: a valid patched config.
  const posHome = freshHome();
  fs.mkdirSync(path.join(posHome, spec.dir), { recursive: true });
  if (spec.dir === '.claude') fs.writeFileSync(path.join(posHome, '.claude', 'settings.json'), '{}\n');
  if (spec.dir === '.gemini') fs.writeFileSync(path.join(posHome, '.gemini', 'settings.json'), '{}\n');
  spec.patch(path.join(posHome, spec.dir), NOTIFY);
  const pos = runCli(spec, posHome);

  if (pos.error && pos.error.code === 'ENOENT') {
    console.log(`SKIP ${cli}: "${spec.bin}" is not installed on this runner.`);
    fs.rmSync(posHome, { recursive: true, force: true });
    process.exit(0);
  }

  // Negative: a deliberately corrupt config.
  const negHome = freshHome();
  fs.mkdirSync(path.join(negHome, spec.dir), { recursive: true });
  spec.corrupt(negHome);
  const neg = runCli(spec, negHome);

  const norm = (r) => ({ status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' });
  const verdict = classifySmoke(norm(pos), norm(neg), PATTERNS);
  console.log(`${cli}: ${verdict}`);
  console.log(`  positive: exit=${pos.status} ${(pos.stderr || pos.stdout || '').trim().split('\n')[0]}`);
  console.log(`  negative: exit=${neg.status} ${(neg.stderr || neg.stdout || '').trim().split('\n')[0]}`);

  fs.rmSync(posHome, { recursive: true, force: true });
  fs.rmSync(negHome, { recursive: true, force: true });

  if (verdict === 'fail') process.exit(1);
  if (requireVerified && verdict !== 'verified') {
    console.error(`  expected 'verified' for ${cli} but got '${verdict}'`);
    process.exit(1);
  }
  process.exit(0);
}

// Only run main when invoked directly (not when imported by tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/smoke-load.test.mjs`
Expected: PASS — `hasConfigError`, `classifySmoke` (all three), and both fixture cases (`verified`, `launch-only`).

- [ ] **Step 6: Verify the harness SKIPs cleanly for a missing CLI**

Run: `node scripts/smoke-load.mjs --cli cursor`
Expected: prints `SKIP cursor: "cursor-agent" is not installed...` and exits 0 (cursor-agent is not installed locally).

- [ ] **Step 7: Confirm the full offline suite still passes**

Run: `npm test`
Expected: previous 83 + the new smoke-load tests pass; `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add scripts/smoke-load.mjs tests/fixtures/fake-cli.mjs tests/smoke-load.test.mjs
git commit -m "test: add smoke-load harness with negative control + offline tests"
```

---

## Task 7: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  unit:
    name: Unit (${{ matrix.os }})
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install
      - run: npm test

  e2e:
    name: E2E real-world (${{ matrix.os }})
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install
      - name: Real ntfy + hook + setup e2e
        run: npm run test:e2e

  agents:
    name: Install + smoke-load CLIs (${{ matrix.os }})
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install
      - name: Install agent CLIs (npm)
        run: npm install -g @anthropic-ai/claude-code @google/gemini-cli @openai/codex
      - name: Assert CLIs run
        run: |
          claude --version
          gemini --version
          codex --version
      - name: Install cursor-agent (best-effort, non-Windows)
        if: runner.os != 'Windows'
        continue-on-error: true
        run: curl https://cursor.com/install -fsS | bash
      - name: Smoke-load Codex (require verified)
        run: node scripts/smoke-load.mjs --cli codex --require-verified
      - name: Smoke-load Claude
        run: node scripts/smoke-load.mjs --cli claude
      - name: Smoke-load Gemini
        run: node scripts/smoke-load.mjs --cli gemini
      - name: Smoke-load Cursor (skips if absent)
        run: node scripts/smoke-load.mjs --cli cursor

  live-gemini:
    name: Live Gemini E2E (free tier)
    runs-on: ubuntu-latest
    continue-on-error: true
    env:
      GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install
      - run: npm install -g @google/gemini-cli
      - name: Drive Gemini end-to-end
        if: ${{ env.GEMINI_API_KEY != '' }}
        run: node scripts/live-gemini.mjs

  live-claude:
    name: Live Claude E2E (optional, paid)
    runs-on: ubuntu-latest
    continue-on-error: true
    env:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install
      - run: npm install -g @anthropic-ai/claude-code
      - name: Drive Claude end-to-end
        if: ${{ env.ANTHROPIC_API_KEY != '' }}
        run: node scripts/live-claude.mjs
```

- [ ] **Step 2: Validate the YAML parses locally**

Run (Linux/macOS): `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('ok')"`
Run (Windows, if python absent): skip — GitHub will validate on push.
Expected: `ok`. If python is unavailable, rely on the first CI run for validation.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add cross-platform pipeline (unit, e2e, agents, live)"
```

---

## Task 8: Tier 2 live-agent scripts

**Files:**
- Create: `scripts/live-gemini.mjs`
- Create: `scripts/live-claude.mjs`

These drive a real LLM with a trivial prompt. Each makes a **hard** assertion
that the agent ran (install + auth + config-load + real call), and a **soft**
assertion that the hook fired into ntfy (logged, not fatal — hook firing in
non-interactive mode is agent-dependent). The job is `continue-on-error`, so it
goes red only when the agent itself breaks.

- [ ] **Step 1: Create the Gemini script**

Create `scripts/live-gemini.mjs`:

```js
// scripts/live-gemini.mjs — Tier 2 live E2E for Gemini (free tier).
// Hard: gemini runs a prompt and returns output. Soft: the AfterAgent hook
// produces an ntfy push. Requires GEMINI_API_KEY in the environment.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patchGemini } from '../setup/patch-config.mjs';
import { randomTopic, writeUserConfig, ntfyPoll } from '../tests/e2e/helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTIFY = path.resolve(__dirname, '..', 'src', 'notify.mjs');

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-live-gemini-'));
  fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), '{}\n');
  const topic = randomTopic('live-gemini');
  writeUserConfig(home, { toast: { enabled: false }, ntfy: { enabled: true, server: 'https://ntfy.sh', topic } });
  patchGemini(path.join(home, '.gemini'), NOTIFY);

  const env = { ...process.env, HOME: home, USERPROFILE: home };
  // Non-interactive prompt. If this flag is wrong for the installed version,
  // the hard assertion below will catch it and we adjust.
  const res = spawnSync('gemini', ['-p', 'Reply with the single word OK.'], {
    encoding: 'utf8', env, timeout: 120000,
  });
  console.log('gemini exit:', res.status);
  console.log('gemini stdout:', (res.stdout || '').slice(0, 500));
  console.log('gemini stderr:', (res.stderr || '').slice(0, 500));

  // HARD: the agent actually ran.
  if (res.status !== 0 || !(res.stdout || '').trim()) {
    console.error('FAIL: gemini did not run successfully');
    process.exit(1);
  }
  console.log('PASS (hard): gemini ran with our config + key');

  // SOFT: did the hook fire into ntfy?
  const msg = await ntfyPoll({ topic, attempts: 8, delayMs: 1500, match: (m) => m.title === 'Gemini' });
  if (msg) console.log('PASS (soft): AfterAgent hook delivered an ntfy push');
  else console.log('NOTE (soft): no ntfy push — hook may not fire in non-interactive mode');

  fs.rmSync(home, { recursive: true, force: true });
  process.exit(0);
}

main();
```

- [ ] **Step 2: Create the Claude script**

Create `scripts/live-claude.mjs`:

```js
// scripts/live-claude.mjs — Tier 2 live E2E for Claude Code (paid key).
// Hard: claude runs a prompt and returns output. Soft: the Stop hook produces
// an ntfy push. Requires ANTHROPIC_API_KEY in the environment.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patchClaude } from '../setup/patch-config.mjs';
import { randomTopic, writeUserConfig, ntfyPoll } from '../tests/e2e/helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTIFY = path.resolve(__dirname, '..', 'src', 'notify.mjs');

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-live-claude-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{}\n');
  const topic = randomTopic('live-claude');
  writeUserConfig(home, { toast: { enabled: false }, ntfy: { enabled: true, server: 'https://ntfy.sh', topic } });
  patchClaude(path.join(home, '.claude'), NOTIFY);

  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const res = spawnSync('claude', ['-p', 'Reply with the single word OK.'], {
    encoding: 'utf8', env, timeout: 120000,
  });
  console.log('claude exit:', res.status);
  console.log('claude stdout:', (res.stdout || '').slice(0, 500));
  console.log('claude stderr:', (res.stderr || '').slice(0, 500));

  if (res.status !== 0 || !(res.stdout || '').trim()) {
    console.error('FAIL: claude did not run successfully');
    process.exit(1);
  }
  console.log('PASS (hard): claude ran with our config + key');

  const msg = await ntfyPoll({ topic, attempts: 8, delayMs: 1500, match: (m) => m.title === 'Claude Code' });
  if (msg) console.log('PASS (soft): Stop hook delivered an ntfy push');
  else console.log('NOTE (soft): no ntfy push — hook may not fire in -p mode');

  fs.rmSync(home, { recursive: true, force: true });
  process.exit(0);
}

main();
```

- [ ] **Step 3: Smoke-check the scripts load without a key (should fail the hard assertion cleanly, not crash on import)**

Run: `node scripts/live-gemini.mjs`
Expected: it attempts to run `gemini` (not installed locally or no key) and exits 1 with `FAIL: gemini did not run successfully` — NOT a module/import error. (This only verifies the script is syntactically sound and wired; real success happens in CI with the secret.)

- [ ] **Step 4: Commit**

```bash
git add scripts/live-gemini.mjs scripts/live-claude.mjs
git commit -m "ci: add Tier 2 live-agent E2E scripts (gemini, claude)"
```

---

## Task 9: README badge + Testing section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the CI badge under the title**

Add near the top of `README.md` (after the first heading):

```markdown
[![CI](https://github.com/DevinoSolutions/ai-agent-notifier/actions/workflows/ci.yml/badge.svg)](https://github.com/DevinoSolutions/ai-agent-notifier/actions/workflows/ci.yml)
```

- [ ] **Step 2: Add a Testing section near the end of the README**

```markdown
## Testing

- `npm test` — fast, offline unit + integration suite.
- `npm run test:e2e` — real-world e2e (requires network): real ntfy.sh delivery,
  real `notify.mjs` invocation, and a real `setup` subprocess.

CI (`.github/workflows/ci.yml`) runs on Linux, macOS, and Windows: the unit
suite, the e2e suite, real installs + smoke-load of the agent CLIs, and
secret-gated live runs of Gemini (free tier) and Claude. The live jobs are
non-blocking and skip automatically when their API-key secrets are absent.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add CI badge and Testing section"
```

---

## Task 10: Push, observe CI, and iterate

**Files:** none (verification task)

- [ ] **Step 1: Run the full offline suite once more**

Run: `npm test`
Expected: `fail 0`.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin ci/real-pipeline-tests
```

- [ ] **Step 3: Watch the run**

Run: `gh run watch --exit-status` (or `gh run list --branch ci/real-pipeline-tests`)
Expected: `unit`, `e2e`, and `agents` jobs green on all three OSes. `live-gemini`/`live-claude` either pass (if secrets are configured) or show their guarded step skipped; being `continue-on-error`, they never block.

- [ ] **Step 4: Triage real-CLI surprises (expected, iterate as needed)**

These are the empirically-determined items the spec flagged as resolved-in-planning. Adjust and re-push if CI reveals:
- **Smoke-load probe choice:** if `codex --version` does not parse `config.toml` (negative control yields `launch-only` instead of `verified`), change `CLIS.codex.args` in `scripts/smoke-load.mjs` to a command that does (try `['config']` or `['exec', '--help']`), re-run the negative control until it's `verified`.
- **cursor-agent:** if the install path differs per OS, the smoke-load `SKIP` is acceptable; leave it logged.
- **Gemini/Claude flags:** if `-p` is wrong for the installed version, fix the flag in the live script; the hard assertion is what surfaces it.

- [ ] **Step 5: Open the PR**

```bash
gh pr create --fill --base main --head ci/real-pipeline-tests
```

---

## Self-review notes

- **Spec coverage:** Tier 1 jobs (unit/e2e/agents) → Tasks 2–7; smoke-load with negative control → Task 6; ntfy round-trip → Task 3; hook invocation → Task 4; real setup → Task 5; Tier 2 live → Tasks 7–8; non-blocking + secret skip → Task 7 (`continue-on-error` + `if: env.* != ''`). README/badge → Task 9. All spec sections map to a task.
- **No duplication:** patcher schema/idempotency/hash/unpatch logic is left to the existing `tests/patch-config*.test.mjs`; new tests only add subprocess, network, install, and smoke layers.
- **Type consistency:** helper names (`randomTopic`, `parseNtfyMessages`, `seedTempHome`, `writeUserConfig`, `runNode`, `ntfyPoll`, `clearLock`) and harness exports (`hasConfigError`, `classifySmoke`) are used identically wherever referenced.
- **Known empirical risks** (real CLI flags) are isolated to Task 10 triage and kept non-blocking so they never wedge the pipeline.
