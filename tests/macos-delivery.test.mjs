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
  extractRecordFields,
  parseNcprefsApps,
  decodeAuthFlags,
  verifyDelivery,
  notificationAuthState,
} from '../src/platforms/macos-delivery.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isMac = os.platform() === 'darwin';
const hasPlutil = (() => { try { execFileSync('which', ['plutil']); return true; } catch { return false; } })();

// Real fixtures captured from a macos-15 CI runner (tests/fixtures/*) back the
// tests below. The record fixture is a bplist BLOB (hex) that needs plutil to
// decode; the ncprefs fixture is already an xml1 conversion, so it parses as text
// on any platform. Each fixture test skips only if its fixture is absent.
const recordFixture = path.join(__dirname, 'fixtures', 'nc-record-sample.txt');
const haveRecordFixture = fs.existsSync(recordFixture);
const ncprefsFixture = path.join(__dirname, 'fixtures', 'ncprefs-sample.xml');
const haveNcprefsFixture = fs.existsSync(ncprefsFixture);

// The raw-scan primitive verifyDelivery is built on: the record BLOB, hex-decoded,
// contains an ASCII marker as a contiguous byte run. This exercises exactly that
// match against the REAL captured record and RUNS everywhere — no plutil, no
// macOS gate — so the delivery-matching machinery is proven on this Windows box.
test('raw NC record BLOB contains ASCII markers as contiguous bytes', () => {
  const raw = Buffer.from(fs.readFileSync(recordFixture, 'utf8').trim(), 'hex');
  assert.equal(raw.includes(Buffer.from('com.apple.tips')), true);
  assert.equal(raw.includes(Buffer.from('Take a look at the new features.')), true);
  assert.equal(raw.includes(Buffer.from('definitely-absent-marker-xyz')), false);
});

// extractRecordFields is the pure xml1→fields step (no plutil, cross-platform).
// Synthetic XML mirrors a real record: titl/body nested under `req`, app at the
// top level, and values carrying &amp;/&lt;/&gt; entities that must be unescaped.
test('extractRecordFields parses titl/body/app and unescapes XML entities (synthetic)', () => {
  const xml = [
    '<plist version="1.0"><dict>',
    '<key>app</key><string>com.apple.tips</string>',
    '<key>req</key><dict>',
    '<key>body</key><string>Take a look &amp; see</string>',
    '<key>titl</key><string>Tom &amp; Jerry &lt;news&gt;</string>',
    '</dict>',
    '<key>date</key><date>2026-07-11T00:00:00Z</date>',
    '</dict></plist>',
  ].join('');
  const rec = extractRecordFields(xml);
  assert.equal(rec.app, 'com.apple.tips');
  assert.equal(rec.body, 'Take a look & see');
  assert.equal(rec.title, 'Tom & Jerry <news>');
  assert.equal(rec.date, '2026-07-11T00:00:00Z');
});

// decodeRecordPlist turns a hex bplist BLOB into { title, body, app, date } via
// `plutil -convert xml1`. The fixture is a REAL record captured from a macos-15
// runner by the spike; title/body/app are pinned to the exact decoded values.
// NOTE: the title's apostrophe is U+2019; we build it with String.fromCharCode
// so this assertion stays pure-ASCII and byte-identical across any file encoding.
test('decodeRecordPlist extracts title and body from a real NC record', { skip: (!hasPlutil || !haveRecordFixture) && 'needs plutil + spike fixture' }, () => {
  const hex = fs.readFileSync(recordFixture, 'utf8').trim();
  const rec = decodeRecordPlist(hex);
  const rsquo = String.fromCharCode(0x2019); // U+2019 right single quotation mark
  assert.equal(rec.title, `See what${rsquo}s new in macOS 15`);
  assert.equal(rec.body, 'Take a look at the new features.');
  assert.equal(rec.app, 'com.apple.tips');
});

test('decodeRecordPlist returns null on garbage input (never throws)', () => {
  assert.equal(decodeRecordPlist('not-hex-zzzz'), null);
  assert.equal(decodeRecordPlist(''), null);
});

// Real ncprefs: the xml1 conversion of a macos-15 runner's com.apple.ncprefs.plist
// (55 apps). Parsed directly as TEXT — no plutil, cross-platform. Proves the parser
// takes each app's own top-level flags and not a nested `src` dict's flags:
// FaceTime is app-level 41951246, whereas its nested src flags is 6.
test('parseNcprefsApps parses real ncprefs xml (app-level flags, not nested)', { skip: !haveNcprefsFixture && 'needs ncprefs xml fixture' }, () => {
  const xml = fs.readFileSync(ncprefsFixture, 'utf8');
  const apps = parseNcprefsApps(xml);
  const faceTime = apps.find((a) => a['bundle-id'] === 'com.apple.FaceTime');
  assert.ok(faceTime, 'FaceTime entry present in real ncprefs');
  assert.equal(faceTime.flags, 41951246);
  // Every real entry decodes to one of the three states, never throws.
  for (const a of apps) {
    assert.ok(['authorized', 'unauthorized', 'unknown'].includes(decodeAuthFlags(a.flags)));
  }
});

// The real-ncprefs test above covers production layout; this SYNTHETIC case pins
// specific robustness the fixture may not exercise: a <data> path blob between
// keys, a nested <dict>, reversed key order (flags BEFORE bundle-id), and a
// trailing top-level key after the array — the depth-aware split must still pair
// each bundle-id with its own flags.
test('parseNcprefsApps extracts (bundle-id, flags) per app, robust to layout (synthetic)', () => {
  const xml = [
    '<plist version="1.0"><dict>',
    '<key>apps</key><array>',
    '<dict>',
    '<key>bundle-id</key><string>com.apple.ScriptEditor2</string>',
    '<key>flags</key><integer>8398094</integer>',
    '<key>path</key><data>YWJjZA==</data>',
    '</dict>',
    '<dict>',
    '<key>flags</key><integer>0</integer>',
    '<key>bundle-id</key><string>com.apple.Terminal</string>',
    '<key>sections</key><dict><key>x</key><integer>1</integer></dict>',
    '</dict>',
    '</array>',
    '<key>version</key><integer>2</integer>',
    '</dict></plist>',
  ].join('');
  const apps = parseNcprefsApps(xml);
  assert.equal(apps.length, 2);
  assert.deepEqual(apps[0], { 'bundle-id': 'com.apple.ScriptEditor2', flags: 8398094 });
  assert.deepEqual(apps[1], { 'bundle-id': 'com.apple.Terminal', flags: 0 });
  // Whatever the flags, each decodes to a valid state and never throws.
  for (const a of apps) {
    assert.ok(['authorized', 'unauthorized', 'unknown'].includes(decodeAuthFlags(a.flags)));
  }
});

test('parseNcprefsApps returns [] when there is no apps array (synthetic)', () => {
  const xml = '<plist version="1.0"><dict><key>version</key><integer>2</integer></dict></plist>';
  assert.deepEqual(parseNcprefsApps(xml), []);
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
