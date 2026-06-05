// tests/e2e/hook-invocation.e2e.test.mjs — real notify.mjs subprocess per source
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { seedTempHome, writeUserConfig, runNode, ntfyPoll, randomTopic } from './helpers.mjs';

// Each entry mirrors how setup/patch-config.mjs wires the hook for that agent.
const CASES = [
  { source: 'claude', args: [], stdin: { hook_event_name: 'Stop', session_id: 'x' }, title: 'Claude Code' },
  { source: 'gemini', args: [], stdin: { hook_event_name: 'AfterAgent', session_id: 'x' }, title: 'Gemini' },
  { source: 'codex', args: ['--event', 'Stop'], stdin: { session_id: 'x' }, title: 'Codex' },
  { source: 'cursor', args: ['--event', 'stop'], stdin: { status: 'completed', loop_count: 0 }, title: 'Cursor' },
];

describe('hook invocation: real notify.mjs → real ntfy push', () => {
  const homes = [];
  after(() => homes.forEach((h) => fs.rmSync(h, { recursive: true, force: true })));

  for (const c of CASES) {
    it(`${c.source} stop event delivers a notification`, async () => {
      const home = seedTempHome();
      homes.push(home);
      const topic = randomTopic(`hook-${c.source}`);
      // Disable toast so headless runners only exercise the ntfy path.
      writeUserConfig(home, { toast: { enabled: false }, ntfy: { enabled: true, server: 'https://ntfy.sh', topic } });

      const proj = `proj-${c.source}`;
      const stdin = JSON.stringify({ ...c.stdin, cwd: `/work/${proj}` });
      const res = runNode(['src/notify.mjs', '--source', c.source, ...c.args], { home, stdin });
      assert.equal(res.status, 0, `notify.mjs exited non-zero: ${res.stderr}`);

      const msg = await ntfyPoll({ topic, match: (m) => m.title === c.title });
      assert.ok(msg, `expected an ntfy push for ${c.source}`);
      assert.match(msg.message, /Task complete/);
    });
  }

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
