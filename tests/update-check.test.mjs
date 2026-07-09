// tests/update-check.test.mjs — the cached update check (CL-04/CL-11).
// Network is dependency-injected, so these run fully offline.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveUpdate, UPDATE_TTL_MS } from '../cli/update-check.mjs';

const tmpDir = path.join(os.tmpdir(), 'update-check-test-' + Date.now());
const cachePath = () => path.join(tmpDir, `.update-check-${Math.random().toString(36).slice(2)}.json`);

describe('resolveUpdate caching', () => {
  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('fetches and persists the result when no cache exists', async () => {
    const cp = cachePath();
    let calls = 0;
    const res = await resolveUpdate(cp, async () => { calls++; return '9.9.9'; }, 1_000_000);
    assert.equal(res, '9.9.9');
    assert.equal(calls, 1);
    const cached = JSON.parse(fs.readFileSync(cp, 'utf8'));
    assert.equal(cached.latest, '9.9.9');
    assert.equal(cached.checkedAt, 1_000_000);
  });

  it('serves a fresh cache without touching the network', async () => {
    const cp = cachePath();
    fs.writeFileSync(cp, JSON.stringify({ checkedAt: 1000, latest: '8.8.8' }));
    let calls = 0;
    const res = await resolveUpdate(cp, async () => { calls++; return '9.9.9'; }, 1000 + UPDATE_TTL_MS - 1);
    assert.equal(res, '8.8.8');
    assert.equal(calls, 0);
  });

  it('re-fetches once the TTL has expired', async () => {
    const cp = cachePath();
    fs.writeFileSync(cp, JSON.stringify({ checkedAt: 1000, latest: '8.8.8' }));
    let calls = 0;
    const res = await resolveUpdate(cp, async () => { calls++; return '9.9.9'; }, 1000 + UPDATE_TTL_MS + 1);
    assert.equal(res, '9.9.9');
    assert.equal(calls, 1);
  });

  it('caches the attempt time even when the check fails (offline stays quiet)', async () => {
    const cp = cachePath();
    const res = await resolveUpdate(cp, async () => { throw new Error('offline'); }, 5000);
    assert.equal(res, null);
    const cached = JSON.parse(fs.readFileSync(cp, 'utf8'));
    assert.equal(cached.checkedAt, 5000);
    assert.equal(cached.latest, null);
  });
});
