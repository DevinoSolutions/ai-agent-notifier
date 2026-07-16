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
import { URGENCY_MAP, buildNotifySendArgs } from '../src/platforms/linux.mjs';

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

describe('linux buildNotifySendArgs — options precede the `--` end-of-options guard', () => {
  it('puts every option before `--` and title/message after it', () => {
    const args = buildNotifySendArgs({ title: 'Claude Code', message: 'app: Task complete', priority: 'urgent' }, '/i.png');
    assert.deepEqual(args, ['--urgency', 'critical', '--icon', '/i.png', '--', 'Claude Code', 'app: Task complete']);
  });

  it('keeps a leading-dash message AFTER `--` so notify-send never parses it as an option', () => {
    // Rich content can start with a dash ("- Fixed the bug"); without the guard
    // GOption would reject it as an unknown option and the toast would silently fail.
    const args = buildNotifySendArgs({ title: 'T', message: '- Fixed the bug', priority: 'default' }, '');
    const sep = args.indexOf('--');
    assert.ok(sep !== -1, 'args must contain the `--` guard');
    assert.equal(args[sep + 2], '- Fixed the bug');
    assert.ok(args.indexOf('- Fixed the bug') > sep, 'the dash-leading message must come after `--`');
  });

  it('omits --icon entirely when no icon path is given', () => {
    const args = buildNotifySendArgs({ title: 'T', message: 'm', priority: 'low' }, '');
    assert.deepEqual(args, ['--urgency', 'low', '--', 'T', 'm']);
  });
});

describe('toast backends fail gracefully (return false, never throw)', () => {
  it('macos sendToast resolves false when osascript is unavailable', async (t) => {
    if (platform === 'darwin') return t.skip('would attempt a real notification on macOS');
    const { sendToast } = await import('../src/platforms/macos.mjs');
    const r = await sendToast({ title: 'T', message: 'M', toastSound: 'default' });
    assert.equal(r, false);
  });

  it('linux sendToast resolves false when notify-send is unavailable', async (t) => {
    if (platform === 'linux') return t.skip('would attempt a real notification on Linux');
    const { sendToast } = await import('../src/platforms/linux.mjs');
    const r = await sendToast({ title: 'T', message: 'M', priority: 'urgent', source: 'claude' });
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
// sets the flag on Windows runners. Linux's notify-send needs a running daemon
// (none on a bare runner), so its real-delivery proof lives in the separate
// scripts/live-toast-linux.mjs job which spins up dunst.
//
// macOS is deliberately NOT proven here: an osascript exit-0 check is the exact
// false-confidence trap this pass replaced (exit 0 ≠ delivered). The real macOS
// proof reads the delivery back from Notification Center's DB in the dedicated
// toast-macos.yml lane (scripts/live-toast-macos.mjs).
describe('native toast fires on its own OS (live — set AAN_TOAST_LIVE=1)', () => {
  const LIVE = process.env.AAN_TOAST_LIVE === '1';

  it('Windows toast.ps1 resolves true', async (t) => {
    if (!LIVE) return t.skip('set AAN_TOAST_LIVE=1 to fire a real notification');
    if (platform !== 'win32') return t.skip('not Windows');
    const { sendToast } = await import('../src/platforms/windows.mjs');
    const r = await sendToast({
      title: 'AAN CI', message: 'Windows native toast test', toastSound: 'Default',
      projectName: 'aan', cwd: process.cwd(), source: 'claude',
    });
    assert.equal(r, true);
  });
});
