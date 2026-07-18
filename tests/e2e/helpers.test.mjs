// tests/e2e/helpers.test.mjs — unit tests for the pure e2e helpers
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomTopic, parseNtfyMessages, seedTempHome, writeUserConfig, clearLock, runNode } from './helpers.mjs';

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
      const cfg = JSON.parse(fs.readFileSync(path.join(home, '.anotifier', 'config.json'), 'utf8'));
      assert.equal(cfg.ntfy.topic, 'xyz');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('clearLock', () => {
  it('removes an existing lock and is a no-op when missing', () => {
    const home = seedTempHome();
    try {
      const dir = path.join(home, '.anotifier');
      fs.mkdirSync(dir, { recursive: true });
      const lock = path.join(dir, '.lock-claude');
      fs.writeFileSync(lock, '123');
      clearLock(home, 'claude');
      assert.equal(fs.existsSync(lock), false);
      assert.doesNotThrow(() => clearLock(home, 'claude')); // missing -> no throw
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('runNode', () => {
  it('runs node with an isolated HOME/USERPROFILE', () => {
    const home = seedTempHome();
    try {
      const res = runNode(['-e', 'process.stdout.write(process.env.HOME + "|" + process.env.USERPROFILE)'], { home });
      assert.equal(res.status, 0);
      assert.ok(res.stdout.includes(home), `expected stdout to include the temp home: ${res.stdout}`);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
