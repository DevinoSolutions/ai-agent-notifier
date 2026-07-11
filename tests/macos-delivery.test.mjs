// tests/macos-delivery.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  ncDbPath,
  decodeRecordPlist,
  decodeAuthFlags,
  verifyDelivery,
  notificationAuthState,
} from '../src/platforms/macos-delivery.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isMac = os.platform() === 'darwin';
const hasPlutil = (() => { try { execFileSync('which', ['plutil']); return true; } catch { return false; } })();

// The plutil-gated tests below also depend on real fixtures captured by the CI
// spike (tests/fixtures/*). Those fixtures do not exist yet on a fresh checkout
// (and never on a Windows dev box), so each fixture test skips unless BOTH plutil
// and its fixture are present.
const recordFixture = path.join(__dirname, 'fixtures', 'nc-record-sample.txt');
const haveRecordFixture = fs.existsSync(recordFixture);
const ncprefsFixture = path.join(__dirname, 'fixtures', 'ncprefs-sample.json');
const haveNcprefsFixture = fs.existsSync(ncprefsFixture);

// decodeRecordPlist turns a hex bplist BLOB into { title, body, app, date }.
// The fixture is a REAL record captured from a macos-15 runner by the spike.
test('decodeRecordPlist extracts title and body from a real NC record', { skip: (!hasPlutil || !haveRecordFixture) && 'needs plutil + spike fixture' }, () => {
  const hex = fs.readFileSync(recordFixture, 'utf8').trim();
  const rec = decodeRecordPlist(hex);
  assert.equal(rec.title, 'AAN-SPIKE');
  assert.match(rec.body, /^spike-real-/);
  assert.ok(typeof rec.app === 'string');
});

test('decodeRecordPlist returns null on garbage input (never throws)', () => {
  assert.equal(decodeRecordPlist('not-hex-zzzz'), null);
  assert.equal(decodeRecordPlist(''), null);
});

// decodeAuthFlags interprets one ncprefs "apps" entry. Fixture is real ncprefs JSON.
test('decodeAuthFlags classifies an app entry from real ncprefs', { skip: (!hasPlutil || !haveNcprefsFixture) && 'needs plutil + spike fixture' }, () => {
  const json = JSON.parse(fs.readFileSync(ncprefsFixture, 'utf8'));
  const apps = json.apps || [];
  // Every real entry decodes to one of the three states, never throws.
  for (const entry of apps) {
    const state = decodeAuthFlags(entry.flags);
    assert.ok(['authorized', 'unauthorized', 'unknown'].includes(state));
  }
});

// On non-mac, ncDbPath is null; on mac it resolves an existing DB or null.
test('ncDbPath returns null off-macOS, a string-or-null on macOS', () => {
  const p = ncDbPath();
  if (!isMac) assert.equal(p, null);
  else assert.ok(p === null || typeof p === 'string');
});

// verifyDelivery never throws and reports a structured miss when there is no DB.
test('verifyDelivery resolves a structured miss when no DB (fast, off-mac)', { skip: isMac && 'this asserts the no-DB path' }, async () => {
  const r = await verifyDelivery('nope', { timeoutMs: 200, pollMs: 50 });
  assert.equal(r.delivered, false);
  assert.equal(r.reason, 'no-nc-db');
});

// notificationAuthState never throws; returns one of the three states.
test('notificationAuthState returns a structured result, never throws', () => {
  const s = notificationAuthState();
  assert.ok(['authorized', 'unauthorized', 'unknown'].includes(s.state));
  assert.ok(typeof s.detail === 'string');
});
