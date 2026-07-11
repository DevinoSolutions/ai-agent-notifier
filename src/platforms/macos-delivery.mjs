// src/platforms/macos-delivery.mjs
//
// Delivery verification for macOS notifications. Zero-dependency: shells out to
// the preinstalled `sqlite3`, `plutil`, and `getconf`. Every function returns a
// structured result and NEVER throws — callers (aan doctor, CI lanes) decide
// severity.
//
// The core idea: macOS logs every DELIVERED notification in Notification
// Center's SQLite DB, including when the banner is suppressed by Focus/DND. So a
// row in that DB proves delivery in a way `osascript` exit codes cannot.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolve the Notification Center records DB. Sequoia (macOS 15) moved it into a
// Group Container; pre-Sequoia used a DARWIN_USER_DIR temp path. Prefer whichever
// exists. Returns null when neither is present (e.g. non-macOS).
export function ncDbPath() {
  if (os.platform() !== 'darwin') return null;
  const home = os.homedir();
  const sequoia = path.join(home, 'Library', 'Group Containers', 'group.com.apple.usernoted', 'db2', 'db');
  if (fs.existsSync(sequoia)) return sequoia;
  try {
    const darwinUserDir = execFileSync('getconf', ['DARWIN_USER_DIR'], { encoding: 'utf8' }).trim();
    const legacy = path.join(darwinUserDir, 'com.apple.notificationcenter', 'db2', 'db');
    if (fs.existsSync(legacy)) return legacy;
  } catch { /* getconf missing/non-macOS */ }
  return null;
}

// Decode one hex-encoded bplist record BLOB into { title, body, app, date }.
// Returns null on any decode failure. Uses plutil via a temp file (plutil reads
// stdin as '-', but a temp file is robust across plutil versions).
export function decodeRecordPlist(hex) {
  if (!hex || !/^[0-9a-fA-F]+$/.test(hex.trim())) return null;
  const clean = hex.trim();
  let tmp;
  try {
    const buf = Buffer.from(clean, 'hex');
    if (buf.length === 0) return null;
    tmp = path.join(os.tmpdir(), `aan-nc-${process.pid}-${buf.length}.bplist`);
    fs.writeFileSync(tmp, buf);
    const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', tmp], { encoding: 'utf8' });
    const obj = JSON.parse(json);
    const req = obj.req || obj.request || {};
    return {
      title: String(req.titl ?? req.title ?? ''),
      body: String(req.body ?? req.subt ?? ''),
      app: String(obj.app ?? obj.bundleid ?? ''),
      date: obj.date ?? null,
    };
  } catch {
    return null;
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
  }
}

// Query the DB read-only for recent record BLOBs (hex). Returns { rows, error }.
// `immutable=1` avoids WAL lock contention with a live usernoted. An "unable to
// open" error is surfaced (callers map it to a TCC-blocked hint).
function queryRecordHex(dbPath, limit = 20) {
  try {
    const out = execFileSync(
      'sqlite3',
      [`file:${dbPath}?mode=ro&immutable=1`, `select hex(data) from record order by rowid desc limit ${limit};`],
      { encoding: 'utf8' },
    );
    return { rows: out.split('\n').map((l) => l.trim()).filter(Boolean), error: null };
  } catch (err) {
    const msg = String(err.stderr || err.message || '');
    return { rows: [], error: /unable to open|authorization denied|not authorized/i.test(msg) ? 'tcc-blocked' : 'query-failed' };
  }
}

// Poll the NC DB until a delivered record's title or body contains `marker`, or
// timeout. Returns { delivered, record?, reason? }. reason ∈
// { 'no-nc-db', 'tcc-blocked', 'timeout' }.
export async function verifyDelivery(marker, { timeoutMs = 30000, pollMs = 1000 } = {}) {
  const dbPath = ncDbPath();
  if (!dbPath) return { delivered: false, reason: 'no-nc-db' };
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  do {
    const { rows, error } = queryRecordHex(dbPath);
    if (error) lastError = error;
    for (const hex of rows) {
      const rec = decodeRecordPlist(hex);
      if (rec && (rec.title.includes(marker) || rec.body.includes(marker))) {
        return { delivered: true, record: rec };
      }
    }
    if (Date.now() < deadline) await sleep(pollMs);
  } while (Date.now() < deadline);
  return { delivered: false, reason: lastError || 'timeout' };
}

// Interpret an ncprefs "apps[].flags" integer into an authorization state.
// The ncprefs flags bitmask encodes per-app notification settings. The bit that
// means "notifications allowed" is DEFAULT_AUTH per the spike's ncprefs dump
// (decision #5). Unknown/undecodable → 'unknown' (callers treat as warn, not
// fail). Conservative by design: we only claim 'unauthorized' when we can read
// the flags and the allow bit is clearly off.
//
// Spike-confirmed: set AUTH_BIT to the observed "banners/alerts enabled" bit.
// The research indicates the low bits govern alert style; bit 0 set with a
// non-"none" alert style = authorized. If the spike shows a cleaner signal
// (e.g. a dedicated key), prefer that and document it here.
const AUTH_BIT = 1 << 0; // placeholder-free default; confirm against fixture in Task 1

export function decodeAuthFlags(flags) {
  if (typeof flags !== 'number' || Number.isNaN(flags)) return 'unknown';
  // A flags value of 0 in ncprefs means "not configured yet" → unknown, not a
  // definitive deny (the app has never posted, so macOS hasn't recorded intent).
  if (flags === 0) return 'unknown';
  return (flags & AUTH_BIT) ? 'authorized' : 'unauthorized';
}

// Read com.apple.ncprefs.plist and classify the app that owns osascript-posted
// notifications on this host. Returns { state, app?, detail }.
export function notificationAuthState() {
  if (os.platform() !== 'darwin') {
    return { state: 'unknown', detail: 'not macOS' };
  }
  const plist = path.join(os.homedir(), 'Library', 'Preferences', 'com.apple.ncprefs.plist');
  let json;
  try {
    json = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' }));
  } catch {
    return { state: 'unknown', detail: 'ncprefs unreadable (may need Full Disk Access)' };
  }
  const apps = Array.isArray(json.apps) ? json.apps : [];
  // osascript notifications are attributed to Script Editor (or the invoking
  // terminal). Look for the most relevant bundle id; fall back to the aggregate.
  const OWNERS = ['com.apple.ScriptEditor2', 'com.apple.Terminal', 'com.apple.osascript'];
  const entry = apps.find((a) => OWNERS.includes(a['bundle-id'] || a.bundleid))
    || apps.find((a) => /ScriptEditor|osascript|Terminal/i.test(a['bundle-id'] || a.bundleid || ''));
  if (!entry) {
    return { state: 'unknown', app: null, detail: 'no notification-owning app registered yet — send one toast to register in System Settings → Notifications' };
  }
  const app = entry['bundle-id'] || entry.bundleid || 'unknown';
  const state = decodeAuthFlags(entry.flags);
  const detail = state === 'authorized'
    ? `${app} is authorized to post notifications`
    : state === 'unauthorized'
      ? `${app} is NOT authorized — banners will be silently dropped; enable it in System Settings → Notifications`
      : `${app} authorization is indeterminate`;
  return { state, app, detail };
}
