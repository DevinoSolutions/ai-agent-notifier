import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// We'll test with a temp dir as home
const tmpDir = path.join(os.tmpdir(), 'ai-agent-notifier-test-' + Date.now());
const configDir = path.join(tmpDir, '.ai-agent-notifier');
const configPath = path.join(configDir, 'config.json');

describe('config-loader', () => {
  beforeEach(() => {
    fs.mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when no user config exists', async () => {
    const { loadConfig } = await import('../src/config-loader.mjs');
    const config = loadConfig(path.join(tmpDir, 'nonexistent', 'config.json'));
    assert.equal(config.ntfy.server, 'https://ntfy.sh');
    assert.equal(config.toast.enabled, true);
    assert.equal(config.events.task_complete.toastSound, 'IM');
  });

  it('merges user config over defaults', async () => {
    const userConfig = {
      ntfy: { topic: 'my-topic', enabled: false }
    };
    fs.writeFileSync(configPath, JSON.stringify(userConfig));
    const { loadConfig } = await import('../src/config-loader.mjs');
    const config = loadConfig(configPath);
    assert.equal(config.ntfy.topic, 'my-topic');
    assert.equal(config.ntfy.enabled, false);
    // defaults preserved for unset keys
    assert.equal(config.ntfy.server, 'https://ntfy.sh');
    assert.equal(config.toast.enabled, true);
  });

  it('falls back to defaults when the user config is corrupt JSON', async () => {
    // A hand-edited broken config must not break notifications — loadConfig
    // swallows the parse error and returns the full default set.
    fs.writeFileSync(configPath, '{ ntfy: this is not, valid json ]]');
    const { loadConfig } = await import('../src/config-loader.mjs');
    const config = loadConfig(configPath);
    assert.equal(config.ntfy.server, 'https://ntfy.sh');
    assert.equal(config.toast.enabled, true);
    assert.equal(config.events.needs_input.priority, 'urgent');
  });

  it('saves config to disk', async () => {
    const { loadConfig, saveConfig } = await import('../src/config-loader.mjs');
    const config = loadConfig(configPath);
    config.ntfy.topic = 'saved-topic';
    saveConfig(config, configPath);
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(raw.ntfy.topic, 'saved-topic');
  });

  it('getConfigDir returns ~/.ai-agent-notifier', async () => {
    const { getConfigDir } = await import('../src/config-loader.mjs');
    const dir = getConfigDir();
    assert.ok(dir.endsWith('.ai-agent-notifier'));
  });
});
