// tests/e2e/helpers.mjs — shared helpers for real-world e2e tests.
// No mocking: these spawn the real CLI, write real files, and hit real ntfy.sh.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, '..', '..');

let counter = 0;
function uniqueSuffix() {
  // Avoid Date.now()/Math.random() collisions across fast calls.
  counter += 1;
  return `${process.pid}-${counter}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function randomTopic(prefix = 'aan-ci') {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
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

// Create an isolated HOME seeded so setup's detectTools() finds all four tools.
export function seedTempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `aan-home-${uniqueSuffix()}-`));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{}\n');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
  return home;
}

// Write ~/.ai-agent-notifier/config.json (merged over defaults by loadConfig).
export function writeUserConfig(home, partial) {
  const dir = path.join(home, '.ai-agent-notifier');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(partial, null, 2) + '\n');
}

// Remove a dedup lock so the same source can fire twice within 10s.
export function clearLock(home, source) {
  try { fs.unlinkSync(path.join(home, '.ai-agent-notifier', `.lock-${source}`)); } catch { /* none */ }
}

// Run a node script from the repo with an isolated HOME. Returns {status, stdout, stderr}.
export function runNode(args, { home, stdin = '', extraEnv = {}, timeout = 120000 } = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...extraEnv };
  const res = spawnSync(process.execPath, args, {
    cwd: repoRoot, input: stdin, env, encoding: 'utf8', timeout,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

// Poll ntfy for a message matching `match`. Returns the message or null.
export async function ntfyPoll({ server = 'https://ntfy.sh', topic, match, attempts = 12, delayMs = 1500 }) {
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
