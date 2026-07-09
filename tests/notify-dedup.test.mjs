// tests/notify-dedup.test.mjs — dedup key composition and the shortened lock
// window. Complements notify-unit.test.mjs (which pins acquire semantics).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dedupKey, acquireNotifyLock } from '../src/notify.mjs';

describe('dedupKey', () => {
  it('keys on source AND event so distinct events never collide', () => {
    const stop = dedupKey({ source: 'claude', event: 'task_complete', sessionId: '' });
    const input = dedupKey({ source: 'claude', event: 'needs_input', sessionId: '' });
    assert.notEqual(stop, input);
    assert.equal(stop, 'claude-task_complete');
  });

  it('includes a session prefix when the tool provides one', () => {
    const a = dedupKey({ source: 'cursor', event: 'task_complete', sessionId: 'abcdef1234567890' });
    const b = dedupKey({ source: 'cursor', event: 'task_complete', sessionId: 'ffffff9999999999' });
    assert.equal(a, 'cursor-task_complete-abcdef12');
    assert.notEqual(a, b, 'different sessions are independent');
  });

  it('sanitizes unsafe filename characters', () => {
    const key = dedupKey({ source: 'weird/tool', event: 'task:done', sessionId: '../../etc' });
    assert.match(key, /^[A-Za-z0-9_.-]+$/);
  });
});

describe('acquireNotifyLock window', () => {
  let base;
  beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-dedup-')); });
  afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

  it('blocks an immediate duplicate of the same key', () => {
    assert.equal(acquireNotifyLock('claude-task_complete', base), true);
    assert.equal(acquireNotifyLock('claude-task_complete', base), false);
  });

  it('allows a different event for the same source at the same time', () => {
    assert.equal(acquireNotifyLock('claude-task_complete', base), true);
    assert.equal(acquireNotifyLock('claude-needs_input', base), true);
  });

  it('re-acquires once the lock is older than the ~1.5s window', () => {
    assert.equal(acquireNotifyLock('claude-task_complete', base), true);
    const lock = path.join(base, '.ai-agent-notifier', '.lock-claude-task_complete');
    const past = new Date(Date.now() - 2000);
    fs.utimesSync(lock, past, past);
    assert.equal(acquireNotifyLock('claude-task_complete', base), true, 'stale lock is replaced');
  });

  it('fails OPEN when the lock dir cannot exist (only EEXIST suppresses)', () => {
    // Occupy the config-dir path with a FILE so mkdir and the exclusive create
    // both fail with something other than EEXIST. A broken filesystem must
    // yield a (possibly duplicate) notification, never silence forever.
    fs.writeFileSync(path.join(base, '.ai-agent-notifier'), 'not a directory');
    assert.equal(acquireNotifyLock('claude-task_complete', base), true);
  });
});
