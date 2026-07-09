// cli/update-check.mjs — cached "is there a newer version?" check.
// Split out of index.mjs so both index and status import it without a circular
// dependency, and so the network fetch runs at most once per command run and at
// most once per 24h (offline/slow networks never repeatedly stall the CLI).
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getConfigDir } from '../src/config-loader.mjs';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

export const UPDATE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_PATH = path.join(getConfigDir(), '.update-check.json');

let inFlight;

// Public entry point. Memoized for the life of the process so a single command
// run makes at most one network request even if several call sites ask.
// Resolves to a newer version string (update available) or null. Never throws.
export function checkForUpdate() {
  if (!inFlight) inFlight = resolveUpdate(CACHE_PATH, fetchLatest, Date.now());
  return inFlight;
}

// Core logic, dependency-injected for tests (cache path, fetch impl, clock).
// A fresh cache (< TTL) is served without any network access. On a stale/absent
// cache we fetch, then persist the result — INCLUDING the timestamp of a failed
// attempt — so an offline machine waits a full TTL before trying again.
export async function resolveUpdate(cachePath, fetchImpl, now) {
  const cached = readCache(cachePath);
  if (cached && typeof cached.checkedAt === 'number' && now - cached.checkedAt < UPDATE_TTL_MS) {
    return cached.latest || null;
  }
  let latest = null;
  try { latest = await fetchImpl(); } catch { latest = null; }
  writeCache(cachePath, { checkedAt: now, latest: latest || null });
  return latest || null;
}

function readCache(cachePath) {
  try { return JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch { return null; }
}

function writeCache(cachePath, data) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(data), 'utf8');
  } catch { /* cache is best-effort — a write failure just re-checks next run */ }
}

// Query npm for the published 'latest' version. Resolves to the version string
// when it differs from ours (an update is available), else null. Never throws.
export function fetchLatest() {
  return new Promise((resolve) => {
    const req = https.get('https://registry.npmjs.org/ai-agent-notifier/latest', { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const latest = JSON.parse(data).version;
          resolve(latest && latest !== pkg.version ? latest : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}
