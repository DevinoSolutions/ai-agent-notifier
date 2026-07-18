// tests/notify-unit.test.mjs — Unit tests for notify.mjs internals.
// These import the REAL exported functions (not re-implementations) so the tests
// fail if production logic diverges. acquireNotifyLock takes a baseDir override
// so it can run against a temp dir instead of the real home.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseArgs, acquireNotifyLock } from '../src/notify.mjs';

describe('acquireNotifyLock (real exported function)', () => {
  let base;
  beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-lock-')); });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  it('first acquire for a source succeeds', () => {
    assert.equal(acquireNotifyLock('claude', base), true);
    const lock = path.join(base, '.anotifier', '.lock-claude');
    assert.ok(fs.existsSync(lock));
    assert.equal(fs.readFileSync(lock, 'utf8'), String(process.pid));
  });

  it('second acquire for the same source fails while the lock is held', () => {
    assert.equal(acquireNotifyLock('claude', base), true);
    assert.equal(acquireNotifyLock('claude', base), false);
  });

  it('different sources get independent locks', () => {
    assert.equal(acquireNotifyLock('claude', base), true);
    assert.equal(acquireNotifyLock('codex', base), true);
  });

  it('cleans a stale lock (>10s old) and re-acquires', () => {
    assert.equal(acquireNotifyLock('claude', base), true);
    const lock = path.join(base, '.anotifier', '.lock-claude');
    const past = new Date(Date.now() - 15000);
    fs.utimesSync(lock, past, past);
    assert.equal(acquireNotifyLock('claude', base), true, 'stale lock should be cleaned and re-acquired');
  });

  it('does NOT clean a fresh lock (<10s old)', () => {
    assert.equal(acquireNotifyLock('claude', base), true);
    // No backdating — lock is fresh, so the second acquire must fail.
    assert.equal(acquireNotifyLock('claude', base), false);
  });

  it('creates the lock directory if it does not exist', () => {
    const nested = path.join(base, 'does', 'not', 'exist');
    assert.equal(acquireNotifyLock('gemini', nested), true);
    assert.ok(fs.existsSync(path.join(nested, '.anotifier', '.lock-gemini')));
  });
});

describe('parseArgs (real exported function)', () => {
  it('defaults source to claude when no args', () => {
    const args = parseArgs(['node', 'notify.mjs']);
    assert.equal(args.source, 'claude');
    assert.equal(args.event, undefined);
  });

  it('parses --source flag', () => {
    const args = parseArgs(['node', 'notify.mjs', '--source', 'codex']);
    assert.equal(args.source, 'codex');
  });

  it('parses --event flag', () => {
    const args = parseArgs(['node', 'notify.mjs', '--source', 'cursor', '--event', 'stop']);
    assert.equal(args.source, 'cursor');
    assert.equal(args.event, 'stop');
  });

  it('handles flags in any order', () => {
    const args = parseArgs(['node', 'notify.mjs', '--event', 'Stop', '--source', 'codex']);
    assert.equal(args.source, 'codex');
    assert.equal(args.event, 'Stop');
  });

  it('ignores --source without value', () => {
    const args = parseArgs(['node', 'notify.mjs', '--source']);
    assert.equal(args.source, 'claude');
  });
});
