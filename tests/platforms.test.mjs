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
