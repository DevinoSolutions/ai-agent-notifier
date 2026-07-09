// tests/e2e/setup.e2e.test.mjs — real `setup` and `uninstall` subprocesses
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seedTempHome, writeUserConfig, runNode, randomTopic } from './helpers.mjs';

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

  it('uninstall removes managed hooks from ALL four tools and Codex trust state', () => {
    const res = runNode(['cli/index.mjs', 'uninstall'], { home, stdin: 'y\n' });
    assert.equal(res.status, 0, `uninstall exited non-zero: ${res.stderr}`);

    // Claude
    const claude = readJSON(path.join(home, '.claude', 'settings.json'));
    assert.equal(claude.hooks.Stop, undefined, 'claude Stop removed');
    assert.equal(claude.hooks.Notification, undefined, 'claude Notification removed');

    // Codex hooks.json
    const codex = readJSON(path.join(home, '.codex', 'hooks.json'));
    assert.equal(codex.hooks.Stop, undefined, 'codex Stop removed');
    assert.equal(codex.hooks.SessionStart, undefined, 'codex SessionStart removed');

    // Codex config.toml — the trust hashes we wrote must be gone too. Otherwise
    // codex keeps a [hooks.state] entry for a hook that no longer exists, and
    // re-install/uninstall cycles accumulate stale keys.
    const toml = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    assert.doesNotMatch(toml, /:stop:\d+:0'\]/, 'codex stop trust key removed');
    assert.doesNotMatch(toml, /:session_start:\d+:0'\]/, 'codex session_start trust key removed');
    assert.doesNotMatch(toml, /trusted_hash/, 'no managed trusted_hash remains');

    // Cursor
    const cursor = readJSON(path.join(home, '.cursor', 'hooks.json'));
    assert.equal(cursor.hooks.stop, undefined, 'cursor stop removed');

    // Gemini
    const gemini = readJSON(path.join(home, '.gemini', 'settings.json'));
    assert.equal(gemini.hooks.AfterAgent, undefined, 'gemini AfterAgent removed');
    assert.equal(gemini.hooks.Notification, undefined, 'gemini Notification removed');
  });
});

describe('setup with partial / no tools installed', () => {
  it('patches only the installed tool and does not create the others', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-partial-'));
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{}\n');
    try {
      const res = runNode(['cli/index.mjs', 'setup'], { home, stdin: 'n\n' }); // n = skip ntfy
      assert.equal(res.status, 0, `setup exited non-zero: ${res.stderr}`);
      const claude = readJSON(path.join(home, '.claude', 'settings.json'));
      assert.ok(claude.hooks.Stop?.length, 'claude patched');
      assert.equal(fs.existsSync(path.join(home, '.codex')), false, 'codex dir not created');
      assert.equal(fs.existsSync(path.join(home, '.gemini')), false, 'gemini dir not created');
      assert.equal(fs.existsSync(path.join(home, '.cursor')), false, 'cursor dir not created');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('exits non-zero and reports nothing was set up when no tools are installed', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-notools-'));
    try {
      const res = runNode(['cli/index.mjs', 'setup'], { home, stdin: '\n' });
      // Nothing was set up — setup must fail loud, not exit 0 with a success banner (CL-16).
      assert.equal(res.status, 1, `setup should exit 1 when no tools are found: ${res.stderr}`);
      assert.match(res.stdout, /No supported AI tools/i);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('test command when ntfy is not configured', () => {
  it('warns and exits 0 instead of erroring', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-testcmd-'));
    writeUserConfig(home, { ntfy: { enabled: false } });
    try {
      const res = runNode(['cli/index.mjs', 'test', 'ntfy'], { home });
      assert.equal(res.status, 0, `test ntfy exited non-zero: ${res.stderr}`);
      assert.match(res.stdout, /ntfy not configured/i);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
