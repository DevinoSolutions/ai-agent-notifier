// tests/error-log.test.mjs — error-log append/rotate/read against a real
// temp directory (no mocks; the module writes real files).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getErrorLogPath,
  logHookError,
  readRecentHookErrors,
  flushErrorReporting,
} from '../src/error-log.mjs';

describe('error-log', () => {
  let base;
  beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-errlog-')); });
  afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

  it('appends a JSONL entry with context, message, and timestamp', () => {
    logHookError('toast:test', new Error('boom'), { detail: 42 }, base);
    const lines = fs.readFileSync(getErrorLogPath(base), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.context, 'toast:test');
    assert.equal(entry.message, 'boom');
    assert.equal(entry.extra.detail, 42);
    assert.ok(entry.ts.includes('T'));
    assert.ok(entry.stack.startsWith('Error: boom'));
  });

  it('stringifies non-Error values instead of throwing', () => {
    logHookError('hook', 'plain string failure', undefined, base);
    const [entry] = readRecentHookErrors(5, base);
    assert.equal(entry.message, 'plain string failure');
  });

  it('readRecentHookErrors returns newest-last and [] when no log exists', () => {
    assert.deepEqual(readRecentHookErrors(5, base), []);
    for (let i = 0; i < 7; i++) logHookError('ctx', new Error(`e${i}`), undefined, base);
    const recent = readRecentHookErrors(3, base);
    assert.equal(recent.length, 3);
    assert.deepEqual(recent.map((e) => e.message), ['e4', 'e5', 'e6']);
  });

  it('rotates the log once it outgrows the size cap, keeping the newest half', () => {
    const logPath = getErrorLogPath(base);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    // Pre-fill just past the 128KB cap with numbered entries
    const filler = [];
    for (let i = 0; i < 1300; i++) {
      filler.push(JSON.stringify({ ts: '', context: 'fill', message: `m${i}`, pad: 'x'.repeat(80) }));
    }
    fs.writeFileSync(logPath, filler.join('\n') + '\n', 'utf8');
    assert.ok(fs.statSync(logPath).size > 128 * 1024, 'precondition: oversized log');

    logHookError('after-rotate', new Error('newest'), undefined, base);

    assert.ok(fs.statSync(logPath).size < 128 * 1024, 'rotated below the cap');
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]);
    assert.equal(last.message, 'newest', 'newest entry survives rotation');
    assert.ok(!lines.some((l) => l.includes('"m0"')), 'oldest entries dropped');
  });

  it('flushErrorReporting resolves immediately when Sentry is not enabled', async () => {
    logHookError('ctx', new Error('local only'), undefined, base);
    await flushErrorReporting(100); // must not hang or throw
  });
});
