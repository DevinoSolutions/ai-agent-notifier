// tests/patch-config-advanced.test.mjs — Advanced patch-config tests
// Covers: canonicalJson, codexHookHash, unpatchAll, corrupt configs, idempotency edge cases
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { canonicalJson, codexHookHash } from '../setup/patch-config.mjs';

const tmpDir = path.join(os.tmpdir(), 'patch-advanced-test-' + Date.now());

describe('canonicalJson (real exported function)', () => {
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

describe('codexHookHash stability (real exported function)', () => {
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

  it('patchClaude throws on non-empty invalid JSON and leaves the file untouched (CL-02)', async () => {
    const { patchClaude } = await import('../setup/patch-config.mjs');
    const claudeDir = path.join(tmpDir, '.claude-corrupt');
    fs.mkdirSync(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, 'settings.json');
    const corrupt = '{{not valid json!!';
    fs.writeFileSync(settingsPath, corrupt);
    // A corrupt real config must NOT be silently overwritten with our hooks.
    assert.throws(
      () => patchClaude(claudeDir, '/home/user/.npm/ai-agent-notifier/src/notify.mjs'),
      /not valid JSON/,
    );
    // File is byte-for-byte unchanged.
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), corrupt);
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

describe('Codex config.toml hooks.state idempotency & repair', () => {
  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  // Count occurrences of each [hooks.state.'<key>'] sub-table header.
  // TOML forbids defining the same table key twice — any count > 1 means
  // codex will fail to load with a "duplicate key" error.
  function stateHeaderCounts(toml) {
    const counts = new Map();
    for (const line of toml.split(/\r?\n/)) {
      const m = line.trim().match(/^\[hooks\.state\.(?:'(.*)'|"(.*)")\]$/);
      if (m) {
        const key = m[1] ?? m[2];
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return counts;
  }

  it('does not duplicate [hooks.state] entries on re-run', async () => {
    const { patchCodex } = await import('../setup/patch-config.mjs');
    const codexDir = path.join(tmpDir, '.codex-state-rerun');
    fs.mkdirSync(codexDir, { recursive: true });
    const notify = '/home/user/.npm/ai-agent-notifier/src/notify.mjs';
    patchCodex(codexDir, notify);
    patchCodex(codexDir, notify);
    const toml = fs.readFileSync(path.join(codexDir, 'config.toml'), 'utf8');
    const counts = stateHeaderCounts(toml);
    for (const [key, count] of counts) {
      assert.equal(count, 1, `duplicate [hooks.state.'${key}'] (${count}x)`);
    }
    // Both managed entries still present exactly once
    assert.ok([...counts.keys()].some(k => k.endsWith(':stop:0:0')));
    assert.ok([...counts.keys()].some(k => k.endsWith(':session_start:0:0')));
  });

  it('repairs a config.toml that already has duplicate hooks.state entries', async () => {
    const { patchCodex } = await import('../setup/patch-config.mjs');
    const codexDir = path.join(tmpDir, '.codex-state-repair');
    fs.mkdirSync(codexDir, { recursive: true });
    const notify = '/home/user/.npm/ai-agent-notifier/src/notify.mjs';

    // A clean install produces two valid managed trust entries.
    patchCodex(codexDir, notify);
    const tomlPath = path.join(codexDir, 'config.toml');
    let toml = fs.readFileSync(tomlPath, 'utf8');
    const blocks = [...toml.matchAll(/\[hooks\.state\.'([^']+)'\]\s*\r?\ntrusted_hash = "([^"]+)"/g)];
    assert.equal(blocks.length, 2, 'expected two managed state entries after first install');
    const [b1, b2] = blocks;

    // Reproduce the real-world breakage seen in ~/.codex/config.toml:
    //   - codex records `enabled = true` on one managed entry
    //   - codex writes a [plugins.*] section AFTER our hooks.state block
    //   - an older buggy setup run appended duplicate state blocks at the end
    toml = toml.replace(
      `[hooks.state.'${b1[1]}']\ntrusted_hash = "${b1[2]}"`,
      `[hooks.state.'${b1[1]}']\nenabled = true\ntrusted_hash = "${b1[2]}"`
    );
    toml += `\n[plugins."github@openai-curated"]\nenabled = true\n`;
    toml += `\n[hooks.state.'${b2[1]}']\ntrusted_hash = "${b2[2]}"\n`;
    toml += `\n[hooks.state.'${b1[1]}']\ntrusted_hash = "${b1[2]}"\n`;
    fs.writeFileSync(tomlPath, toml, 'utf8');

    // Sanity: the seeded file is genuinely broken (a key appears more than once).
    assert.ok([...stateHeaderCounts(toml).values()].some(c => c > 1), 'seed must contain a duplicate');

    // Re-running setup must repair the file in place.
    patchCodex(codexDir, notify);
    const after = fs.readFileSync(tomlPath, 'utf8');
    const counts = stateHeaderCounts(after);
    for (const [key, count] of counts) {
      assert.equal(count, 1, `duplicate [hooks.state.'${key}'] remains (${count}x)`);
    }
    // Unrelated codex-owned sections are preserved.
    assert.ok(after.includes('[plugins."github@openai-curated"]'), 'plugins section preserved');
    // Both managed trust entries survive with their hashes.
    assert.ok(after.includes(`[hooks.state.'${b1[1]}']`));
    assert.ok(after.includes(`[hooks.state.'${b2[1]}']`));
    assert.ok(after.includes(`trusted_hash = "${b1[2]}"`));
    assert.ok(after.includes(`trusted_hash = "${b2[2]}"`));
  });
});

describe('unpatchAll Codex config.toml trust cleanup', () => {
  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('removes our [hooks.state] trust keys but preserves foreign ones', async () => {
    const { patchCodex, unpatchAll } = await import('../setup/patch-config.mjs');
    const home = path.join(tmpDir, 'home-unpatch');
    const codexDir = path.join(home, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    const notify = '/home/user/.npm/ai-agent-notifier/src/notify.mjs';
    patchCodex(codexDir, notify);

    const tomlPath = path.join(codexDir, 'config.toml');
    let toml = fs.readFileSync(tomlPath, 'utf8');
    assert.match(toml, /trusted_hash/, 'precondition: our trust hashes were written');

    // Seed a foreign trust entry that codex itself (or another tool) could own.
    toml += `\n[hooks.state.'/other/hooks.json:stop:0:0']\ntrusted_hash = "sha256:deadbeefcafe"\n`;
    fs.writeFileSync(tomlPath, toml, 'utf8');

    unpatchAll(home);

    const after = fs.readFileSync(tomlPath, 'utf8');
    // Foreign entry survives verbatim.
    assert.match(after, /\[hooks\.state\.'\/other\/hooks\.json:stop:0:0'\]/, 'foreign trust entry preserved');
    assert.match(after, /sha256:deadbeefcafe/, 'foreign hash preserved');
    // Our entries are gone — session_start is uniquely ours, and only the foreign
    // trusted_hash should remain.
    assert.doesNotMatch(after, /:session_start:/, 'our session_start trust key removed');
    assert.equal((after.match(/trusted_hash/g) || []).length, 1, 'only the foreign trust entry remains');
    // The [features] hooks flag is intentionally left intact.
    assert.match(after, /hooks = true/, 'feature flag preserved');
  });
});
