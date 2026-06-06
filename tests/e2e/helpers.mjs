// tests/e2e/helpers.mjs — shared helpers for real-world e2e tests.
// No mocking: these spawn the real CLI, write real files, and hit real ntfy.sh.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, '..', '..');

// Real agent/key env vars are scrubbed from spawned processes so e2e runs are
// hermetic: behavior must come from the patched config, never from a key that
// happens to be set on the runner (or the developer's machine). The live-* tier
// spawns its CLIs directly (not via these helpers), so it keeps its key.
export const SCRUB_KEYS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY', 'GOOGLE_CLOUD_PROJECT',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CURSOR_API_KEY', 'NTFY_TOKEN', 'NTFY_PASSWORD',
];

function scrubbedEnv(home, extraEnv = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...extraEnv };
  for (const k of SCRUB_KEYS) delete env[k];
  return env;
}

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

// Run a node script from the repo with an isolated, key-scrubbed HOME.
// Returns {status, stdout, stderr}.
export function runNode(args, { home, stdin = '', extraEnv = {}, timeout = 120000 } = {}) {
  const res = spawnSync(process.execPath, args, {
    cwd: repoRoot, input: stdin, env: scrubbedEnv(home, extraEnv), encoding: 'utf8', timeout,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

// Async variant for launching processes concurrently (e.g. to race the dedup lock).
export function runNodeAsync(args, { home, stdin = '', extraEnv = {}, timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: repoRoot, env: scrubbedEnv(home, extraEnv) });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    const timer = setTimeout(() => child.kill(), timeout);
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
    child.on('error', () => { clearTimeout(timer); resolve({ status: 1, stdout, stderr }); });
    child.stdin.end(stdin);
  });
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

// Collect ALL distinct matching messages over the poll window (deduped by id).
// Used to assert an exact delivery count, e.g. that the dedup lock yields exactly
// one push for two concurrent invocations.
export async function ntfyCollect({ server = 'https://ntfy.sh', topic, match, attempts = 10, delayMs = 1500 }) {
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
  const seen = new Map();
  for (let i = 0; i < attempts; i++) {
    const body = await getOnce();
    for (const m of parseNtfyMessages(body)) {
      if (m.id && (!match || match(m))) seen.set(m.id, m);
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return [...seen.values()];
}
