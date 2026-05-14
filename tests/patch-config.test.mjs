// tests/patch-config.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpDir = path.join(os.tmpdir(), 'patch-config-test-' + Date.now());

describe('patch-config', () => {
  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('creates hooks.json for Codex when none exists', async () => {
    const { patchCodex } = await import('../setup/patch-config.mjs');
    const codexDir = path.join(tmpDir, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    patchCodex(codexDir, '/path/to/notify.mjs');
    const hooks = JSON.parse(fs.readFileSync(path.join(codexDir, 'hooks.json'), 'utf8'));
    assert.ok(hooks.hooks.Stop);
    assert.ok(hooks.hooks.PermissionRequest);
  });

  it('merges into existing Claude settings.json without overwriting', async () => {
    const { patchClaude } = await import('../setup/patch-config.mjs');
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const existing = {
      model: 'claude-opus-4-6',
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }]
      }
    };
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(existing));
    patchClaude(claudeDir, '/path/to/notify.mjs');
    const result = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    // Existing keys preserved
    assert.equal(result.model, 'claude-opus-4-6');
    assert.ok(result.hooks.PreToolUse);
    // New hooks added
    assert.ok(result.hooks.Notification);
    assert.ok(result.hooks.Stop);
  });

  it('creates backup before first patch', async () => {
    const { patchClaude } = await import('../setup/patch-config.mjs');
    const claudeDir = path.join(tmpDir, '.claude2');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{"model":"test"}');
    const backupDir = path.join(tmpDir, 'backups');
    patchClaude(claudeDir, '/path/to/notify.mjs', backupDir);
    const backups = fs.readdirSync(backupDir);
    assert.ok(backups.length > 0);
  });

  it('tags managed hooks for uninstall', async () => {
    const { patchCursor } = await import('../setup/patch-config.mjs');
    const cursorDir = path.join(tmpDir, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });
    patchCursor(cursorDir, '/path/to/notify.mjs');
    const hooks = JSON.parse(fs.readFileSync(path.join(cursorDir, 'hooks.json'), 'utf8'));
    const stopHook = hooks.hooks.stop[0];
    assert.equal(stopHook._managed_by, 'ai-agent-notifier');
  });

  it('is idempotent — does not duplicate hooks on re-run', async () => {
    const { patchClaude } = await import('../setup/patch-config.mjs');
    const claudeDir = path.join(tmpDir, '.claude3');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{}');
    patchClaude(claudeDir, '/path/to/notify.mjs');
    patchClaude(claudeDir, '/path/to/notify.mjs');
    const result = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    // Should have exactly one ai-agent-notifier hook per event, not duplicates
    const notifHooks = result.hooks.Notification;
    const managedCount = notifHooks.filter(h =>
      h.hooks?.some(hh => hh.command?.includes('ai-agent-notifier') || hh.command?.includes('notify.mjs'))
    ).length;
    assert.equal(managedCount, 1);
  });
});
