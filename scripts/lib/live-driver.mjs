// scripts/lib/live-driver.mjs — shared scaffolding for the Tier 2 live-* drivers
// (scripts/live-{claude,codex,cursor,gemini}.mjs). This is the production home of
// the pieces those drivers had duplicated; tests/e2e/helpers.mjs re-exports the
// generic bits from here so the dependency points tests → scripts (never the
// reverse — production code must not import from tests/).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';

// ---------------------------------------------------------------------------
// Generic helpers (also re-exported by tests/e2e/helpers.mjs)
// ---------------------------------------------------------------------------

// Unguessable per-run ntfy topic so parallel/repeat CI runs never cross streams.
export function randomTopic(prefix = 'aan-ci') {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
}

// Write ~/.ai-agent-notifier/config.json (merged over defaults by loadConfig).
export function writeUserConfig(home, partial) {
  const dir = path.join(home, '.ai-agent-notifier');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(partial, null, 2) + '\n');
}

// Parse ntfy's newline-delimited JSON stream, returning only delivered messages.
export function parseNtfyMessages(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      if (obj && obj.event === 'message') out.push(obj);
    } catch { /* ignore non-JSON lines */ }
  }
  return out;
}

// Poll ntfy for a message matching `match`. Returns the message or null.
// The default attempt budget is deliberately generous: the live tier hits the
// real public ntfy.sh, so a few extra polls absorb transient network latency.
export async function ntfyPoll({ server = 'https://ntfy.sh', topic, match, attempts = 18, delayMs = 1500 }) {
  const url = `${server.replace(/\/+$/, '')}/${topic}/json?poll=1`;
  const transport = url.startsWith('https:') ? https : http;
  const getOnce = () => new Promise((resolve) => {
    const req = transport.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
  });
  for (let i = 0; i < attempts; i++) {
    const body = await getOnce();
    const hit = parseNtfyMessages(body).find(match);
    if (hit) return hit;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Driver scaffolding (consolidates the boilerplate the four live-* drivers had
// copy-pasted). The parameters expose the REAL divergences between drivers:
// which env key, temp-home base (tmpdir vs the real homedir for Codex), which
// tool subdir, and whether the tool needs a seeded settings.json.
// ---------------------------------------------------------------------------

// HARD env-key guard. A missing key is a configuration failure, not a reason to
// skip: print `message` and exit 1. Returns the key's value.
export function requireEnvKey(name, { message } = {}) {
  const val = process.env[name];
  if (!val) {
    console.error(message || `FAIL: ${name} is not set — this live driver requires a real key.`);
    process.exit(1);
  }
  return val;
}

// Like requireEnvKey but accepts the first of several env vars (Cursor's BYO
// mode reuses OPENAI_API_KEY/ANTHROPIC_API_KEY). Returns the NAME of the env var
// that was found so the caller can report the real variable (not a hardcoded one).
export function requireAnyEnvKey(names, { message } = {}) {
  const found = names.find((n) => process.env[n]);
  if (!found) {
    console.error(message || `FAIL: no API key found — set one of: ${names.join(', ')}.`);
    process.exit(1);
  }
  return found;
}

// Create an isolated HOME with the tool's config dir, an optional seeded
// settings file, and the user config that routes notifications to `topic`.
// `base` is os.tmpdir() by default; Codex refuses to create helper binaries under
// /tmp, so it passes os.homedir().
export function setupIsolatedHome({ prefix, dir, topic, base = os.tmpdir(), seedSettingsFile = null, ntfyServer = 'https://ntfy.sh' }) {
  const home = fs.mkdtempSync(path.join(base, prefix));
  fs.mkdirSync(path.join(home, dir), { recursive: true });
  if (seedSettingsFile) fs.writeFileSync(path.join(home, dir, seedSettingsFile), '{}\n');
  writeUserConfig(home, { toast: { enabled: false }, ntfy: { enabled: true, server: ntfyServer, topic } });
  return home;
}

// HARD: poll ntfy for the delivered push and fail (exit 1) if it never arrives.
// Consolidates the poll → assert → log block shared by the Claude and Gemini
// drivers. Returns the matched message on success.
//
// `assertBody(msg)` is an optional HARD gate on the delivered BODY. The ntfy body
// is deterministic — ntfy rich content is default-OFF for privacy (see
// src/transcript.mjs), so the body is always the generic router message
// ("<project>: Task complete"), never the assistant's words — so gating on it is
// safe and not intermittent. The matched body is always LOGGED (it used to be
// invisible: only a fixed pass string was printed, so historical runs could not
// prove what body actually shipped).
export async function pollForPush({ topic, match, attempts = 22, delayMs = 2000, failMessage, passMessage, assertBody, bodyFailMessage }) {
  const msg = await ntfyPoll({ topic, match, attempts, delayMs });
  if (!msg) {
    console.error(failMessage || 'FAIL: hook did not deliver an ntfy push within the poll window');
    process.exit(1);
  }
  console.log(`  ntfy push received — title="${msg.title}" body="${msg.message ?? ''}"`);
  if (passMessage) console.log(passMessage);
  if (assertBody && !assertBody(msg)) {
    console.error(bodyFailMessage || `FAIL: ntfy push body did not match expectation — body="${msg.message ?? ''}"`);
    process.exit(1);
  }
  return msg;
}

// HARD: read + validate a patched hooks.json. Accepts either capitalization of
// the event key (Codex writes `Stop`, Cursor writes `stop`) and either the
// nested `{ hooks: [{ command }] }` or flat `{ command }` entry shape. Exits 1
// with a specific message on any failure; returns the parsed object on success.
export function assertHooksJsonPatched(hooksPath, { event = 'Stop' } = {}) {
  let hooks;
  try {
    hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  } catch (err) {
    console.error(`FAIL: hooks.json is not valid JSON after patch: ${err.message}`);
    process.exit(1);
  }

  const cap = event.charAt(0).toUpperCase() + event.slice(1);
  const low = event.toLowerCase();
  const list = hooks.hooks?.[event] || hooks.hooks?.[cap] || hooks.hooks?.[low] || [];
  if (!Array.isArray(list) || list.length === 0) {
    console.error(`FAIL: hooks.json missing ${event} hook after patch: ${JSON.stringify(hooks, null, 2)}`);
    process.exit(1);
  }

  const entry = list[0];
  const cmd = entry?.hooks?.[0]?.command || entry?.command || '';
  if (!cmd.includes('notify.mjs')) {
    console.error(`FAIL: ${event} hook command does not reference notify.mjs: ${cmd}`);
    process.exit(1);
  }
  return hooks;
}

// A short unique marker safe to embed in an agent prompt and match later in a
// notification title/body. Distinct from randomTopic (which is an ntfy topic).
export function nonceMarker(prefix = 'aan') {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
}

// Like setupIsolatedHome but leaves toast ENABLED (macOS delivery lanes need the
// real toast to fire so it records in Notification Center). ntfy still on for the
// push assertion. Everything else identical.
export function setupIsolatedHomeWithToast(opts) {
  const home = setupIsolatedHome(opts);
  // Re-write user config with toast enabled (setupIsolatedHome disables it).
  writeUserConfig(home, {
    toast: { enabled: true },
    ntfy: { enabled: true, server: opts.ntfyServer || 'https://ntfy.sh', topic: opts.topic },
  });
  return home;
}
