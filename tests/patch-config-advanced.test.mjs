// tests/patch-config-advanced.test.mjs — Advanced patch-config tests
// Covers: canonicalJson, codexHookHash, unpatchAll, corrupt configs, idempotency edge cases
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpDir = path.join(os.tmpdir(), 'patch-advanced-test-' + Date.now());

describe('canonicalJson', () => {
  // Replicate the function to verify hash stability
  function canonicalJson(val) {
    if (val === null || val === undefined) return JSON.stringify(null);
    if (typeof val !== 'object') return JSON.stringify(val);
    if (Array.isArray(val)) return '[' + val.map(canonicalJson).join(',') + ']';
    const sorted = Object.keys(val).sort();
    return '{' + sorted.map(k => JSON.stringify(k) + ':' + canonicalJson(val[k])).join(',') + '}';
  }

  it('sorts object keys alphabetically', () => {
    const result = canonicalJson({ z: 1, a: 2, m: 3 });
    assert.equal(result, '{"a":2,"m":3,"z":1}');
  });

  it('handles nested objects recursively', () => {
    const result = canonicalJson({ b: { z: 1, a: 2 }, a: 'hello' });
    assert.equal(result, '{"a":"hello","b":{"a":2,"z":1}}');
  });

  it('preserves array order', () => {
    const result = canonicalJson([3, 1, 2]);
    assert.equal(result, '[3,1,2]');
  });

  it('handles null and undefined as null', () => {
    assert.equal(canonicalJson(null), 'null');
    assert.equal(canonicalJson(undefined), 'null');
  });

  it('handles booleans and numbers', () => {
    assert.equal(canonicalJson(true), 'true');
    assert.equal(canonicalJson(42), '42');
    assert.equal(canonicalJson('str'), '"str"');
  });

  it('produces deterministic output regardless of insertion order', () => {
    const obj1 = { command: 'node x', async: false, type: 'command', timeout: 10 };
    const obj2 = { type: 'command', timeout: 10, async: false, command: 'node x' };
    assert.equal(canonicalJson(obj1), canonicalJson(obj2));
  });
});

describe('codexHookHash stability', () => {
  // The hash must be stable across runs — if it changes, Codex will reject hooks
  function canonicalJson(val) {
    if (val === null || val === undefined) return JSON.stringify(null);
    if (typeof val !== 'object') return JSON.stringify(val);
    if (Array.isArray(val)) return '[' + val.map(canonicalJson).join(',') + ']';
    const sorted = Object.keys(val).sort();
    return '{' + sorted.map(k => JSON.stringify(k) + ':' + canonicalJson(val[k])).join(',') + '}';
  }

  function codexHookHash(eventName, command, { timeout, matcher, isAsync = false, statusMessage } = {}) {
    const handler = {
      async: isAsync,
      command,
      timeout: Math.max(1, timeout ?? 600),
      type: 'command',
    };
    if (statusMessage != null) handler.statusMessage = statusMessage;
    const identity = { event_name: eventName, hooks: [handler] };
    if (matcher != null) identity.matcher = matcher;
    const json = canonicalJson(identity);
    const hash = crypto.createHash('sha256').update(json).digest('hex');
    return `sha256:${hash}`;
  }

  it('produces consistent hash for same inputs', () => {
    const hash1 = codexHookHash('stop', 'node /path/notify.mjs --source codex --event Stop', { timeout: 10, statusMessage: 'Sending notification' });
    const hash2 = codexHookHash('stop', 'node /path/notify.mjs --source codex --event Stop', { timeout: 10, statusMessage: 'Sending notification' });
    assert.equal(hash1, hash2);
  });

  it('different commands produce different hashes', () => {
    const hash1 = codexHookHash('stop', 'node /path/a.mjs', { timeout: 10 });
    const hash2 = codexHookHash('stop', 'node /path/b.mjs', { timeout: 10 });
    assert.notEqual(hash1, hash2);
  });

  it('different event names produce different hashes', () => {
    const hash1 = codexHookHash('stop', 'node x', { timeout: 10 });
    const hash2 = codexHookHash('session_start', 'node x', { timeout: 10 });
    assert.notEqual(hash1, hash2);
  });

  it('hash starts with sha256: prefix', () => {
    const hash = codexHookHash('stop', 'node x', { timeout: 10 });
    assert.ok(hash.startsWith('sha256:'));
    assert.equal(hash.length, 7 + 64); // "sha256:" + 64 hex chars
  });

  it('statusMessage affects hash', () => {
    const hash1 = codexHookHash('stop', 'node x', { timeout: 10, statusMessage: 'A' });
    const hash2 = codexHookHash('stop', 'node x', { timeout: 10, statusMessage: 'B' });
    assert.notEqual(hash1, hash2);
  });

  it('omitting statusMessage differs from including it', () => {
    const hash1 = codexHookHash('stop', 'node x', { timeout: 10 });
    const hash2 = codexHookHash('stop', 'node x', { timeout: 10, statusMessage: 'msg' });
    assert.notEqual(hash1, hash2);
  });

  it('timeout defaults to 600 when not specified', () => {
    const hash1 = codexHookHash('stop', 'node x', {});
    const hash2 = codexHookHash('stop', 'node x', { timeout: 600 });
    assert.equal(hash1, hash2);
  });
});

describe('unpatchAll', () => {
  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('removes managed hooks from Claude settings.json', async () => {
    const { patchClaude, unpatchAll } = await import('../setup/patch-config.mjs');
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo safety' }] }],
      }
    }));
    patchClaude(claudeDir, '/home/user/.npm/ai-agent-notifier/src/notify.mjs');
    // Verify hooks were added
    let settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    assert.ok(settings.hooks.Stop.length > 0);
    // Unpatch
    unpatchAll(tmpDir);
    settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    // Our hooks removed (event key deleted when empty), user hooks preserved
    assert.equal(settings.hooks.Stop, undefined);
    assert.equal(settings.hooks.Notification, undefined);
    assert.equal(settings.hooks.PreToolUse.length, 1);
  });

  it('removes managed hooks from Codex hooks.json', async () => {
    const { patchCodex, unpatchAll } = await import('../setup/patch-config.mjs');
    const codexDir = path.join(tmpDir, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    patchCodex(codexDir, '/home/user/.npm/ai-agent-notifier/src/notify.mjs');
    unpatchAll(tmpDir);
    const hooks = JSON.parse(fs.readFileSync(path.join(codexDir, 'hooks.json'), 'utf8'));
    // Events deleted when empty after removing managed hooks
    assert.equal(hooks.hooks.Stop, undefined);
    assert.equal(hooks.hooks.SessionStart, undefined);
  });

  it('handles missing config files gracefully', async () => {
    const { unpatchAll } = await import('../setup/patch-config.mjs');
    // No tool dirs exist — should not throw
    const emptyHome = path.join(tmpDir, 'empty-home');
    fs.mkdirSync(emptyHome, { recursive: true });
    assert.doesNotThrow(() => unpatchAll(emptyHome));
  });
});

describe('corrupt config handling', () => {
  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('patchClaude handles invalid JSON in settings.json', async () => {
    const { patchClaude } = await import('../setup/patch-config.mjs');
    const claudeDir = path.join(tmpDir, '.claude-corrupt');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{{not valid json!!');
    // Should not throw — treats as empty
    assert.doesNotThrow(() => patchClaude(claudeDir, '/home/user/.npm/ai-agent-notifier/src/notify.mjs'));
    const result = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    assert.ok(result.hooks.Stop);
  });

  it('patchCodex handles empty hooks.json', async () => {
    const { patchCodex } = await import('../setup/patch-config.mjs');
    const codexDir = path.join(tmpDir, '.codex-empty');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, 'hooks.json'), '');
    assert.doesNotThrow(() => patchCodex(codexDir, '/home/user/.npm/ai-agent-notifier/src/notify.mjs'));
    const result = JSON.parse(fs.readFileSync(path.join(codexDir, 'hooks.json'), 'utf8'));
    assert.ok(result.hooks.Stop);
  });

  it('patchCursor handles pre-existing hooks from another tool', async () => {
    const { patchCursor } = await import('../setup/patch-config.mjs');
    const cursorDir = path.join(tmpDir, '.cursor-existing');
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.writeFileSync(path.join(cursorDir, 'hooks.json'), JSON.stringify({
      version: 1,
      hooks: { stop: [{ command: 'echo user-hook' }] }
    }));
    patchCursor(cursorDir, '/home/user/.npm/ai-agent-notifier/src/notify.mjs');
    const result = JSON.parse(fs.readFileSync(path.join(cursorDir, 'hooks.json'), 'utf8'));
    // User hook preserved, our hook added
    assert.equal(result.hooks.stop.length, 2);
    assert.ok(result.hooks.stop.some(h => h.command === 'echo user-hook'));
    assert.ok(result.hooks.stop.some(h => h.command.includes('notify.mjs')));
  });
});

describe('Codex config.toml feature flag', () => {
  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('adds [features] hooks = true when config.toml is empty', async () => {
    const { patchCodex } = await import('../setup/patch-config.mjs');
    const codexDir = path.join(tmpDir, '.codex-no-toml');
    fs.mkdirSync(codexDir, { recursive: true });
    patchCodex(codexDir, '/home/user/.npm/ai-agent-notifier/src/notify.mjs');
    const toml = fs.readFileSync(path.join(codexDir, 'config.toml'), 'utf8');
    assert.ok(toml.includes('[features]'));
    assert.ok(toml.includes('hooks = true'));
  });

  it('migrates deprecated codex_hooks to hooks', async () => {
    const { patchCodex } = await import('../setup/patch-config.mjs');
    const codexDir = path.join(tmpDir, '.codex-deprecated');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, 'config.toml'), '[features]\ncodex_hooks = true\n');
    patchCodex(codexDir, '/home/user/.npm/ai-agent-notifier/src/notify.mjs');
    const toml = fs.readFileSync(path.join(codexDir, 'config.toml'), 'utf8');
    assert.ok(!toml.includes('codex_hooks'));
    assert.ok(toml.includes('hooks = true'));
  });

  it('does not duplicate hooks = true on re-run', async () => {
    const { patchCodex } = await import('../setup/patch-config.mjs');
    const codexDir = path.join(tmpDir, '.codex-rerun');
    fs.mkdirSync(codexDir, { recursive: true });
    patchCodex(codexDir, '/home/user/.npm/ai-agent-notifier/src/notify.mjs');
    patchCodex(codexDir, '/home/user/.npm/ai-agent-notifier/src/notify.mjs');
    const toml = fs.readFileSync(path.join(codexDir, 'config.toml'), 'utf8');
    const matches = toml.match(/hooks = true/g);
    assert.equal(matches.length, 1);
  });
});

describe('Windows path normalization', () => {
  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('Codex hooks use forward slashes even with backslash input', async () => {
    const { patchCodex } = await import('../setup/patch-config.mjs');
    const codexDir = path.join(tmpDir, '.codex-winpath');
    fs.mkdirSync(codexDir, { recursive: true });
    patchCodex(codexDir, 'C:\\Users\\dev\\.npm\\ai-agent-notifier\\src\\notify.mjs');
    const hooks = JSON.parse(fs.readFileSync(path.join(codexDir, 'hooks.json'), 'utf8'));
    const cmd = hooks.hooks.Stop[0].hooks[0].command;
    assert.ok(!cmd.includes('\\'), `Command should use forward slashes: ${cmd}`);
    assert.ok(cmd.includes('C:/Users/dev/.npm/ai-agent-notifier'));
  });

  it('Cursor hooks use forward slashes even with backslash input', async () => {
    const { patchCursor } = await import('../setup/patch-config.mjs');
    const cursorDir = path.join(tmpDir, '.cursor-winpath');
    fs.mkdirSync(cursorDir, { recursive: true });
    patchCursor(cursorDir, 'C:\\Users\\dev\\ai-agent-notifier\\src\\notify.mjs');
    const hooks = JSON.parse(fs.readFileSync(path.join(cursorDir, 'hooks.json'), 'utf8'));
    const cmd = hooks.hooks.stop[0].command;
    assert.ok(!cmd.includes('\\'), `Command should use forward slashes: ${cmd}`);
  });
});
