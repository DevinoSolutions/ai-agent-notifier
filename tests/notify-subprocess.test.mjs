// tests/notify-subprocess.test.mjs — runs the REAL notify.mjs entry point as a
// subprocess to prove a hook can never crash the host AI tool. Channels are
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

// Default seed disables EVERY channel — toast, ntfy, AND terminalBell — so the
// crash-safety cases below keep asserting a plain '{}' hook response. Since F1 a
// claude run with the bell enabled emits a non-empty terminalSequence JSON
// object, so leaving terminalBell at its default (true) would break them. Tests
// that exercise the bell pass an explicit config override as the 4th argument.
const ALL_DISABLED = { toast: { enabled: false }, ntfy: { enabled: false }, terminalBell: { enabled: false } };

function runNotify(input, source = 'claude', extraArgs = [], config = ALL_DISABLED) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-notify-sub-'));
  const cfgDir = path.join(home, '.ai-agent-notifier');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, 'config.json'), JSON.stringify(config));
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
    assert.deepEqual(JSON.parse(res.stdout), {});
  });

  it('exits 0 and writes {} on empty stdin', () => {
    const res = runNotify('');
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), {});
  });

  it('exits 0 and writes {} on an unmapped event name', () => {
    const res = runNotify(JSON.stringify({ hook_event_name: 'PreToolUse', cwd: '/x', session_id: 's' }));
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), {});
  });

  it('logs the unmapped event name to errors.log so misconfigured wiring is visible', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-notify-unmapped-'));
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    for (const k of SCRUB) delete env[k];
    const res = spawnSync(process.execPath, ['src/notify.mjs', '--source', 'claude'], {
      cwd: repoRoot,
      input: JSON.stringify({ hook_event_name: 'PreToolUse', cwd: '/x', session_id: 's' }),
      env, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(res.status, 0, res.stderr);
    const log = fs.readFileSync(path.join(home, '.ai-agent-notifier', 'errors.log'), 'utf8');
    assert.match(log, /"context":"router"/);
    assert.match(log, /PreToolUse/);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('exits 0 on a valid completed event with all channels disabled', () => {
    const res = runNotify(JSON.stringify({ hook_event_name: 'Stop', cwd: '/work/app', session_id: 's' }));
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), {});
  });

  it('exits 0 for a Codex --event invocation with no stdin hook name', () => {
    const res = runNotify(JSON.stringify({ session_id: 's' }), 'codex', ['--event', 'Stop']);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), {});
  });

  it('exits 0, emits a valid hook response, and logs a config:parse entry on a corrupt config.json', () => {
    // Unlike runNotify (which seeds a valid config and deletes the home), this test
    // keeps its own home so it can read back the JSONL error log afterward.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-notify-badcfg-'));
    const cfgDir = path.join(home, '.ai-agent-notifier');
    fs.mkdirSync(cfgDir, { recursive: true });
    // Deliberately invalid JSON: the loader must fall back to defaults, keep the
    // hook alive (exit 0 + valid JSON), and record the parse failure to errors.log.
    fs.writeFileSync(path.join(cfgDir, 'config.json'), '{ not: valid json ,,, ');
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    for (const k of SCRUB) delete env[k];
    const res = spawnSync(process.execPath, ['src/notify.mjs', '--source', 'claude'], {
      cwd: repoRoot,
      input: JSON.stringify({ hook_event_name: 'Stop', cwd: '/work/app', session_id: 's' }),
      env, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(res.status, 0, res.stderr);
    // Corrupt config falls back to defaults, where terminalBell is enabled — so
    // this claude Stop legitimately rings via terminalSequence. The point of the
    // test is exit-0 survival plus the logged config:parse entry below.
    assert.deepEqual(JSON.parse(res.stdout), { terminalSequence: '\x07' });
    const log = fs.readFileSync(path.join(cfgDir, 'errors.log'), 'utf8');
    assert.match(log, /config:parse/, `errors.log should record a config:parse entry, got: ${log}`);
    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe('notify.mjs claude terminalSequence bell (F1)', () => {
  // Claude Code >=2.1.141 rings by writing a bare BEL from a top-level
  // terminalSequence hook response through its own terminal path; notify.mjs
  // emits that ONLY on the fully-successful claude path with the bell enabled,
  // and never spawns bell.mjs for claude (that would double-ring tmux).
  const BELL_RESPONSE = { terminalSequence: '\x07' };
  const stop = JSON.stringify({ hook_event_name: 'Stop', cwd: '/work/app', session_id: 's' });

  it('claude Stop with the bell enabled emits a terminalSequence BEL and nothing else', () => {
    const res = runNotify(stop, 'claude', [], { toast: { enabled: false }, ntfy: { enabled: false }, terminalBell: { enabled: true } });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), BELL_RESPONSE);
  });

  it('claude Stop with the bell disabled emits exactly {}', () => {
    const res = runNotify(stop, 'claude', [], { toast: { enabled: false }, ntfy: { enabled: false }, terminalBell: { enabled: false } });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, '{}\n');
  });

  it('codex Stop keeps bell.mjs and never emits terminalSequence, even with the bell enabled', () => {
    const res = runNotify(JSON.stringify({ session_id: 's' }), 'codex', ['--event', 'Stop'], { toast: { enabled: false }, ntfy: { enabled: false }, terminalBell: { enabled: true } });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, '{}\n');
  });

  it('a suppressed duplicate claude event does not ring (second run emits {})', () => {
    // Both invocations must share one HOME so the second collides with the
    // first's dedup lock — runNotify makes a fresh HOME per call, so spawn here.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-notify-dedup-'));
    const cfgDir = path.join(home, '.ai-agent-notifier');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, 'config.json'),
      JSON.stringify({ toast: { enabled: false }, ntfy: { enabled: false }, terminalBell: { enabled: true } }),
    );
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    for (const k of SCRUB) delete env[k];
    const input = JSON.stringify({ hook_event_name: 'Stop', cwd: '/work/app', session_id: 'dup' });
    const spawn = () => spawnSync(process.execPath, ['src/notify.mjs', '--source', 'claude'], {
      cwd: repoRoot, input, env, encoding: 'utf8', timeout: 30000,
    });
    const first = spawn();
    const second = spawn();
    fs.rmSync(home, { recursive: true, force: true });
    // First run wins the lock and rings; the suppressed duplicate stays silent.
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(JSON.parse(first.stdout), BELL_RESPONSE);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout, '{}\n');
  });
});
