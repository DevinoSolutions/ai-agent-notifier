// tests/e2e/hook-invocation.e2e.test.mjs — real notify.mjs subprocess per source,
// asserting the actual ntfy push (title, message, priority, tags) on the wire.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { seedTempHome, writeUserConfig, runNode, ntfyPoll, randomTopic } from './helpers.mjs';

// ntfy priority numbers: 5 = urgent/max, 3 = default (often omitted from the
// JSON), 2 = low. tags arrive as an array of strings.
const isDefaultPriority = (p) => p === undefined || p === 3;

// task_complete: default priority + white_check_mark tag.
const TASK_COMPLETE_CASES = [
  { source: 'claude', args: [], stdin: { hook_event_name: 'Stop', session_id: 'x' }, title: 'Claude Code' },
  { source: 'gemini', args: [], stdin: { hook_event_name: 'AfterAgent', session_id: 'x' }, title: 'Gemini' },
  { source: 'codex', args: ['--event', 'Stop'], stdin: { session_id: 'x' }, title: 'Codex' },
  { source: 'cursor', args: ['--event', 'stop'], stdin: { status: 'completed', loop_count: 0 }, title: 'Cursor' },
];

// needs_input: urgent priority + bell,warning tags. (cursor has no needs_input event.)
const NEEDS_INPUT_CASES = [
  { source: 'claude', args: [], stdin: { hook_event_name: 'Notification', session_id: 'x' }, title: 'Claude Code' },
  { source: 'gemini', args: [], stdin: { hook_event_name: 'Notification', session_id: 'x' }, title: 'Gemini' },
  { source: 'codex', args: ['--event', 'PermissionRequest'], stdin: { session_id: 'x' }, title: 'Codex' },
];

describe('hook invocation: real notify.mjs → real ntfy push', () => {
  const homes = [];
  after(() => homes.forEach((h) => fs.rmSync(h, { recursive: true, force: true })));

  const fire = (c, topicPrefix) => {
    const home = seedTempHome();
    homes.push(home);
    const topic = randomTopic(`${topicPrefix}-${c.source}`);
    // Disable toast so headless runners only exercise the ntfy path.
    writeUserConfig(home, { toast: { enabled: false }, ntfy: { enabled: true, server: 'https://ntfy.sh', topic } });
    const proj = `proj-${c.source}`;
    const stdin = JSON.stringify({ ...c.stdin, cwd: `/work/${proj}` });
    const res = runNode(['src/notify.mjs', '--source', c.source, ...c.args], { home, stdin });
    assert.equal(res.status, 0, `notify.mjs exited non-zero: ${res.stderr}`);
    return topic;
  };

  for (const c of TASK_COMPLETE_CASES) {
    it(`${c.source} task_complete delivers a default-priority push with the check tag`, async () => {
      const topic = fire(c, 'done');
      const msg = await ntfyPoll({ topic, match: (m) => m.title === c.title });
      assert.ok(msg, `expected an ntfy push for ${c.source}`);
      assert.match(msg.message, /Task complete/);
      assert.ok(isDefaultPriority(msg.priority), `expected default priority, got ${msg.priority}`);
      assert.ok((msg.tags || []).includes('white_check_mark'), `expected white_check_mark tag, got ${JSON.stringify(msg.tags)}`);
    });
  }

  for (const c of NEEDS_INPUT_CASES) {
    it(`${c.source} needs_input delivers an URGENT push with bell+warning tags`, async () => {
      const topic = fire(c, 'input');
      const msg = await ntfyPoll({ topic, match: (m) => m.title === c.title });
      assert.ok(msg, `expected an ntfy push for ${c.source}`);
      assert.match(msg.message, /Needs your input/);
      assert.equal(msg.priority, 5, `expected urgent priority (5), got ${msg.priority}`);
      const tags = msg.tags || [];
      assert.ok(tags.includes('bell') && tags.includes('warning'), `expected bell+warning tags, got ${JSON.stringify(tags)}`);
    });
  }

  it('session_start delivers NO push (suppressed by default config)', async () => {
    const home = seedTempHome();
    homes.push(home);
    const topic = randomTopic('sess');
    // ntfy enabled, but default config sets session_start ntfyEnabled:false.
    writeUserConfig(home, { ntfy: { enabled: true, server: 'https://ntfy.sh', topic } });
    const stdin = JSON.stringify({ hook_event_name: 'SessionStart', cwd: '/work/x', session_id: 's' });
    const res = runNode(['src/notify.mjs', '--source', 'claude'], { home, stdin });
    assert.equal(res.status, 0, `notify.mjs exited non-zero: ${res.stderr}`);
    // Negative assertion: poll a short window; a regression that drops the
    // suppression would deliver promptly and fail this.
    const msg = await ntfyPoll({ topic, match: () => true, attempts: 5, delayMs: 1200 });
    assert.equal(msg, null, 'session_start must not deliver an ntfy push');
  });

  it('does not throw when toast is enabled but no backend exists', () => {
    const home = seedTempHome();
    homes.push(home);
    // toast enabled (default), ntfy disabled — proves graceful handling on headless runners.
    writeUserConfig(home, { ntfy: { enabled: false } });
    const stdin = JSON.stringify({ hook_event_name: 'Stop', cwd: '/work/x', session_id: 'x' });
    const res = runNode(['src/notify.mjs', '--source', 'claude'], { home, stdin });
    assert.equal(res.status, 0, `notify.mjs should exit 0 even with no toast backend: ${res.stderr}`);
  });
});
