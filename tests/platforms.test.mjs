// tests/platforms.test.mjs — toast backend coverage.
// Pure helpers (esc, URGENCY_MAP) are tested everywhere. The spawn + error path
// is exercised by invoking a backend whose OS doesn't match the host: its tool is
// absent (or its script is incompatible), so it must resolve false instead of
// displaying a real notification. The native backend is skipped to avoid firing a
// visible toast during the test run.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { esc } from '../src/platforms/macos.mjs';
import { URGENCY_MAP } from '../src/platforms/linux.mjs';

const platform = os.platform();

describe('macos esc() — AppleScript string escaping', () => {
  it('escapes double quotes', () => {
    assert.equal(esc('say "hi"'), 'say \\"hi\\"');
  });
  it('escapes backslashes', () => {
    assert.equal(esc('a\\b'), 'a\\\\b');
  });
  it('escapes a backslash followed by a quote (order matters)', () => {
    // input: \"  ->  \\ then \"  =>  \\\"
    assert.equal(esc('\\"'), '\\\\\\"');
  });
  it('returns empty string for empty/undefined/null', () => {
    assert.equal(esc(''), '');
    assert.equal(esc(undefined), '');
    assert.equal(esc(null), '');
  });
  it('leaves safe text unchanged', () => {
    assert.equal(esc('my-app: Task complete'), 'my-app: Task complete');
  });
});

describe('linux URGENCY_MAP — ntfy priority → notify-send urgency', () => {
  it('maps every known priority', () => {
    assert.equal(URGENCY_MAP.urgent, 'critical');
    assert.equal(URGENCY_MAP.high, 'normal');
    assert.equal(URGENCY_MAP.default, 'low');
    assert.equal(URGENCY_MAP.low, 'low');
  });
});

describe('toast backends fail gracefully (return false, never throw)', () => {
  it('macos sendToast resolves false when osascript is unavailable', async (t) => {
    if (platform === 'darwin') return t.skip('would attempt a real notification on macOS');
    const { sendToast } = await import('../src/platforms/macos.mjs');
    const r = await sendToast({ title: 'T', message: 'M', sound: 'default' });
    assert.equal(r, false);
  });

  it('linux sendToast resolves false when notify-send is unavailable', async (t) => {
    if (platform === 'linux') return t.skip('would attempt a real notification on Linux');
    const { sendToast } = await import('../src/platforms/linux.mjs');
    const r = await sendToast({ title: 'T', message: 'M', ntfyPriority: 'urgent', source: 'claude' });
    assert.equal(r, false);
  });

  it('windows sendToast resolves false when the toast script cannot run', async (t) => {
    if (platform === 'win32') return t.skip('would attempt a real toast on Windows');
    const { sendToast } = await import('../src/platforms/windows.mjs');
    const r = await sendToast({ title: 'T', message: 'M', projectName: 'p', cwd: '/x', source: 'claude' });
    assert.equal(r, false);
  });
});

// Native success path: actually FIRE a notification on the host OS and assert
// the backend reports success. Gated behind AAN_TOAST_LIVE=1 so a normal local
// `npm test` never pops a toast in the developer's face; CI's toast-native job
// sets the flag on macOS + Windows runners. Linux's notify-send needs a running
// daemon (none on a bare runner), so its real-delivery proof lives in the
// separate scripts/live-toast-linux.mjs job which spins up dunst.
describe('native toast fires on its own OS (live — set AAN_TOAST_LIVE=1)', () => {
  const LIVE = process.env.AAN_TOAST_LIVE === '1';

  it('macOS osascript notification resolves true', async (t) => {
    if (!LIVE) return t.skip('set AAN_TOAST_LIVE=1 to fire a real notification');
    if (platform !== 'darwin') return t.skip('not macOS');
    const { sendToast } = await import('../src/platforms/macos.mjs');
    const r = await sendToast({ title: 'AAN CI', message: 'macOS native toast test', sound: 'default' });
    assert.equal(r, true);
  });

  it('Windows toast.ps1 resolves true', async (t) => {
    if (!LIVE) return t.skip('set AAN_TOAST_LIVE=1 to fire a real notification');
    if (platform !== 'win32') return t.skip('not Windows');
    const { sendToast } = await import('../src/platforms/windows.mjs');
    const r = await sendToast({
      title: 'AAN CI', message: 'Windows native toast test', sound: 'Default',
      projectName: 'aan', cwd: process.cwd(), source: 'claude',
    });
    assert.equal(r, true);
  });
});
