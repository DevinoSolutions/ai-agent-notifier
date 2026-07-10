// tests/e2e/bell.e2e.test.mjs — E2E subprocess tests for terminal bell integration.
// Spawns the real notify.mjs process and asserts the hook exits 0 with the bell channel
// enabled (default), disabled, and per-event-suppressed. For source claude the bell is
// delivered as {"terminalSequence":"\x07"} in the hook's stdout JSON (Claude Code >=2.1.141
// rings it through its own terminal write path); other sources write BEL to /dev/tty, which
// is not capturable without a pty. These tests verify the dispatch path completes cleanly
// and the stdout contract holds — not that a terminal audibly rang (that side is covered
// by tests/bell.test.mjs and the platform tests).
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { seedTempHome, writeUserConfig, runNode } from './helpers.mjs';

describe('terminal bell e2e — subprocess invocation', () => {
  const homes = [];
  after(() => homes.forEach((h) => fs.rmSync(h, { recursive: true, force: true })));

  it('bell channel is attempted when terminalBell.enabled is true (default)', () => {
    const home = seedTempHome();
    homes.push(home);
    // Disable toast and ntfy to isolate bell behavior. Bell is enabled by default.
    writeUserConfig(home, { toast: { enabled: false }, ntfy: { enabled: false } });
    const stdin = JSON.stringify({ hook_event_name: 'Stop', cwd: '/work/proj', session_id: 'x' });
    const res = runNode(['src/notify.mjs', '--source', 'claude'], { home, stdin });
    assert.equal(res.status, 0, `notify.mjs exited non-zero: ${res.stderr}`);
    // Claude bell rides the hook response itself: Claude Code >=2.1.141 rings the BEL
    // from the terminalSequence field, so its presence IS the bell dispatch.
    assert.deepEqual(
      JSON.parse(res.stdout),
      { terminalSequence: '\x07' },
      'claude hook response must carry the bell as terminalSequence',
    );
  });

  it('bell channel is excluded when terminalBell.enabled is false', () => {
    const home = seedTempHome();
    homes.push(home);
    writeUserConfig(home, { toast: { enabled: false }, ntfy: { enabled: false }, terminalBell: { enabled: false } });
    const stdin = JSON.stringify({ hook_event_name: 'Stop', cwd: '/work/proj', session_id: 'x' });
    const res = runNode(['src/notify.mjs', '--source', 'claude'], { home, stdin });
    assert.equal(res.status, 0, `notify.mjs exited non-zero: ${res.stderr}`);
    assert.deepEqual(JSON.parse(res.stdout), {}, 'hook must emit exactly {} with bell disabled');
  });

  it('bell channel respects per-event terminalBellEnabled override', () => {
    const home = seedTempHome();
    homes.push(home);
    writeUserConfig(home, {
      toast: { enabled: false },
      ntfy: { enabled: false },
      terminalBell: { enabled: true },
      events: { task_complete: { terminalBellEnabled: false } },
    });
    const stdin = JSON.stringify({ hook_event_name: 'Stop', cwd: '/work/proj', session_id: 'x' });
    const res = runNode(['src/notify.mjs', '--source', 'claude'], { home, stdin });
    assert.equal(res.status, 0, `notify.mjs exited non-zero: ${res.stderr}`);
    assert.deepEqual(JSON.parse(res.stdout), {}, 'hook must emit exactly {} (no terminalSequence) when per-event-suppressed');
  });

  it('all three channels coexist without interference', () => {
    const home = seedTempHome();
    homes.push(home);
    // Enable all channels — bell + toast + ntfy (ntfy without topic = no-op).
    writeUserConfig(home, {
      toast: { enabled: true },
      ntfy: { enabled: true, server: 'https://ntfy.sh', topic: '' },
      terminalBell: { enabled: true },
    });
    const stdin = JSON.stringify({ hook_event_name: 'Stop', cwd: '/work/proj', session_id: 'x' });
    const res = runNode(['src/notify.mjs', '--source', 'claude'], { home, stdin });
    assert.equal(res.status, 0, `notify.mjs should handle all channels gracefully: ${res.stderr}`);
  });
});
