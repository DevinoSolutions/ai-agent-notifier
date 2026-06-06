// tests/notify-subprocess.test.mjs — runs the REAL notify.mjs entry point as a
// subprocess to prove a hook can never crash the host AI tool. Both channels are
// disabled via config so the run is fully offline (no toast, no network).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRUB = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'CURSOR_API_KEY', 'NTFY_TOKEN'];

function runNotify(input, source = 'claude', extraArgs = []) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-notify-sub-'));
  const cfgDir = path.join(home, '.ai-agent-notifier');
  fs.mkdirSync(cfgDir, { recursive: true });
  // Disable both channels: the subprocess should still exit 0 and emit {}.
  fs.writeFileSync(
    path.join(cfgDir, 'config.json'),
    JSON.stringify({ toast: { enabled: false }, ntfy: { enabled: false } })
  );
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const k of SCRUB) delete env[k];
  const res = spawnSync(process.execPath, ['src/notify.mjs', '--source', source, ...extraArgs], {
    cwd: repoRoot, input, env, encoding: 'utf8', timeout: 30000,
  });
  fs.rmSync(home, { recursive: true, force: true });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

describe('notify.mjs subprocess robustness (a hook must never crash)', () => {
  it('exits 0 and writes {} on malformed JSON stdin', () => {
    const res = runNotify('not json {{{[[[ <garbage>');
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /\{\}/);
  });

  it('exits 0 and writes {} on empty stdin', () => {
    const res = runNotify('');
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /\{\}/);
  });

  it('exits 0 and writes {} on an unmapped event name', () => {
    const res = runNotify(JSON.stringify({ hook_event_name: 'PreToolUse', cwd: '/x', session_id: 's' }));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /\{\}/);
  });

  it('exits 0 on a valid completed event with both channels disabled', () => {
    const res = runNotify(JSON.stringify({ hook_event_name: 'Stop', cwd: '/work/app', session_id: 's' }));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /\{\}/);
  });

  it('exits 0 for a Codex --event invocation with no stdin hook name', () => {
    const res = runNotify(JSON.stringify({ session_id: 's' }), 'codex', ['--event', 'Stop']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /\{\}/);
  });
});
