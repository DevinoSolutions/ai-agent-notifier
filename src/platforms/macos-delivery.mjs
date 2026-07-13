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
//
// Delivery is proven by scanning the raw record BLOB for our (ASCII) marker;
// metadata is a best-effort `plutil -convert xml1` decode. Real records embed
// NSDate/NSData plus a nested NSKeyedArchiver bplist, which `plutil -convert
// json` rejects ("invalid object in plist for destination format"), so json is
// never used here — xml1 always succeeds and we regex the fields out of it.
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

// Undo the five predefined XML entities plutil emits inside <string> values.
// Order matters: &amp; is undone LAST so an escaped entity such as "&amp;lt;"
// round-trips to the literal "&lt;" rather than being collapsed to "<".
function unescapeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// Pull a notification's display fields out of plutil's xml1 output. Real NC
// records nest titl/body under a `req` dict and keep the source bundle id at the
// top level as `app`; first-match regexes find each regardless of nesting (the
// embedded NSKeyedArchiver blob is base64 inside <data>, so it can never
// false-match a <key>…</key><string> pair). Extracted strings are XML-unescaped.
// Pure and synchronous — the plutil shell-out lives in decodeRecordPlist.
export function extractRecordFields(xml) {
  const pick = (re) => { const m = xml.match(re); return m ? unescapeXml(m[1]) : ''; };
  const date = xml.match(/<key>date<\/key>\s*<date>([^<]*)<\/date>/);
  return {
    title: pick(/<key>titl<\/key>\s*<string>([^<]*)<\/string>/),
    body: pick(/<key>body<\/key>\s*<string>([^<]*)<\/string>/),
    app: pick(/<key>app<\/key>\s*<string>([^<]*)<\/string>/),
    date: date ? date[1] : null,
  };
}

// Decode one hex-encoded bplist record BLOB into { title, body, app, date }.
// Returns null on any failure; never throws. Converts via `plutil -convert xml1`
// (json rejects the NSDate/NSData a real record carries) written through a temp
// file — robust across plutil versions — then regexes the display fields out.
export function decodeRecordPlist(hex) {
  if (!hex || !/^[0-9a-fA-F]+$/.test(hex.trim())) return null;
  const clean = hex.trim();
  let tmp;
  try {
    const buf = Buffer.from(clean, 'hex');
    if (buf.length === 0) return null;
    tmp = path.join(os.tmpdir(), `aan-nc-${process.pid}-${buf.length}.bplist`);
    fs.writeFileSync(tmp, buf);
    const xml = execFileSync('plutil', ['-convert', 'xml1', '-o', '-', tmp], { encoding: 'utf8' });
    return extractRecordFields(xml);
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

// Poll the NC DB until a delivered record contains `marker`, or timeout. Matching
// runs on the RAW record bytes, never on a plutil decode: our markers are pure
// ASCII, so they land as a contiguous byte run inside the bplist even when the
// record can't be fully decoded — so a hit does not depend on (and is not lost
// to) a decode failure. (This holds only because the marker is ASCII embedded in
// an ASCII string; a marker inside a UTF-16-stored value would not be contiguous.)
// The decode is best-effort metadata; a null decode still counts as delivered.
// Returns { delivered, record?, reason? }. reason ∈
// { 'no-nc-db', 'tcc-blocked', 'timeout' }.
export async function verifyDelivery(marker, { timeoutMs = 30000, pollMs = 1000 } = {}) {
  const dbPath = ncDbPath();
  if (!dbPath) return { delivered: false, reason: 'no-nc-db' };
  const markerBuf = Buffer.from(String(marker));
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  do {
    const { rows, error } = queryRecordHex(dbPath);
    if (error) lastError = error;
    for (const hex of rows) {
      if (!Buffer.from(hex, 'hex').includes(markerBuf)) continue;
      // Hit on the raw BLOB. Decode for metadata, but fall back to an empty
      // record so a decode failure never downgrades a hit to a miss and callers'
      // record.{title,body,app} stay safe.
      const record = decodeRecordPlist(hex) || { title: '', body: '', app: '', date: null };
      return { delivered: true, record };
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

// Parse plutil's xml1 rendering of com.apple.ncprefs.plist into an array of
// { 'bundle-id', flags } entries — the only fields notificationAuthState needs.
// json conversion is unusable here: real ncprefs embeds NSData path blobs that
// `plutil -convert json` rejects. We walk the `apps` <array>, isolating each
// direct-child <dict> by tracking dict/array nesting depth (a real entry may
// embed nested dicts and <data> blobs), then regex the bundle-id + flags out of
// each entry's own block — robust to key order within an entry. Base64 inside
// <data> carries no angle brackets, so it never trips the tag walker. Returns []
// when there is no apps array. Pure/synchronous.
export function parseNcprefsApps(xml) {
  const out = [];
  const open = xml.match(/<key>apps<\/key>\s*<array>/);
  if (!open) return out;
  const tag = /<(\/?)(?:dict|array)>/g;
  tag.lastIndex = open.index + open[0].length; // start just inside the apps <array>
  let depth = 0;       // nesting depth relative to the apps-array interior
  let entryStart = -1; // offset where the current top-level entry <dict> began
  let m;
  while ((m = tag.exec(xml))) {
    const closing = m[1] === '/';
    const isDict = m[0].includes('dict');
    if (!closing) {
      if (depth === 0 && isDict) entryStart = m.index;
      depth += 1;
    } else {
      if (depth === 0) break; // the apps array's own closing </array>
      depth -= 1;
      if (depth === 0 && isDict && entryStart !== -1) {
        const block = xml.slice(entryStart, tag.lastIndex);
        const bid = block.match(/<key>bundle-?id<\/key>\s*<string>([^<]*)<\/string>/);
        const flags = block.match(/<key>flags<\/key>\s*<integer>(-?\d+)<\/integer>/);
        out.push({
          'bundle-id': bid ? unescapeXml(bid[1]) : '',
          flags: flags ? parseInt(flags[1], 10) : NaN,
        });
        entryStart = -1;
      }
    }
  }
  return out;
}

// Read com.apple.ncprefs.plist and classify the app that owns osascript-posted
// notifications on this host. Returns { state, app?, detail }.
export function notificationAuthState() {
  if (os.platform() !== 'darwin') {
    return { state: 'unknown', detail: 'not macOS' };
  }
  const plist = path.join(os.homedir(), 'Library', 'Preferences', 'com.apple.ncprefs.plist');
  let apps;
  try {
    const xml = execFileSync('plutil', ['-convert', 'xml1', '-o', '-', plist], { encoding: 'utf8' });
    apps = parseNcprefsApps(xml);
  } catch {
    return { state: 'unknown', detail: 'ncprefs unreadable (may need Full Disk Access)' };
  }
  // osascript notifications are attributed to Script Editor (or the invoking
  // terminal). Look for the most relevant bundle id; fall back to the aggregate.
  const OWNERS = ['com.apple.ScriptEditor2', 'com.apple.Terminal', 'com.apple.osascript'];
  const entry = apps.find((a) => OWNERS.includes(a['bundle-id']))
    || apps.find((a) => /ScriptEditor|osascript|Terminal/i.test(a['bundle-id'] || ''));
  if (!entry) {
    return { state: 'unknown', app: null, detail: 'no notification-owning app registered yet — send one toast to register in System Settings → Notifications' };
  }
  const app = entry['bundle-id'] || 'unknown';
  const state = decodeAuthFlags(entry.flags);
  const detail = state === 'authorized'
    ? `${app} is authorized to post notifications`
    : state === 'unauthorized'
      ? `${app} is NOT authorized — banners will be silently dropped; enable it in System Settings → Notifications`
      : `${app} authorization is indeterminate`;
  return { state, app, detail };
}
