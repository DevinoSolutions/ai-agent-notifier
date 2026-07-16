// tests/doctor.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { runChecks, CHECK_IDS, linuxDeepToastCheck } from '../cli/doctor-checks.mjs';

test('runChecks returns one result per known check id, all well-formed', async () => {
  const results = await runChecks({ config: baseConfig(), deep: false });
  const ids = results.map((r) => r.id);
  for (const id of CHECK_IDS[os.platform()] || CHECK_IDS.default) {
    assert.ok(ids.includes(id), `missing check ${id}`);
  }
  for (const r of results) {
    assert.ok(['ok', 'warn', 'fail'].includes(r.status), `bad status ${r.status} for ${r.id}`);
    assert.ok(typeof r.channel === 'string');
    assert.ok(typeof r.detail === 'string');
  }
});

test('ntfy check warns when unconfigured, ok when configured (never publishes)', async () => {
  const off = await runChecks({ config: baseConfig(), deep: false });
  assert.equal(off.find((r) => r.id === 'ntfy-config').status, 'warn');

  const on = await runChecks({
    config: { ...baseConfig(), ntfy: { enabled: true, server: 'https://ntfy.sh', topic: 'x' } },
    deep: false,
  });
  assert.notEqual(on.find((r) => r.id === 'ntfy-config').status, 'fail');
});

test('config check fails on an invalid config object', async () => {
  const results = await runChecks({ config: null, configProblem: { message: 'bad json' }, deep: false });
  assert.equal(results.find((r) => r.id === 'config').status, 'fail');
});

test('runChecks never throws even with a hostile config', async () => {
  await assert.doesNotReject(runChecks({ config: { events: 'not-an-object' }, deep: false }));
});

test('deep on a platform with no deep probe reports it explicitly (never silently no-ops)', async (t) => {
  if (os.platform() === 'darwin') return t.skip('darwin has a real --deep probe (NC read-back)');
  if (os.platform() === 'linux') return t.skip('linux has a real --deep probe (dunst read-back) — see linuxDeepToastCheck tests');
  const results = await runChecks({ config: baseConfig(), deep: true });
  const probe = results.find((r) => r.id === 'deep-probe');
  assert.ok(probe, 'a deep-probe row must be present when --deep is unavailable');
  assert.equal(probe.status, 'info');
  assert.match(probe.detail, /deep verification not available/);
});

// The Linux --deep probe is deps-injected so these run on any OS (incl. Windows CI).
const dunstHistory = (title, message) =>
  JSON.stringify({ data: [[{ summary: { data: title }, body: { data: message } }]] });

test('linuxDeepToastCheck: dunstctl present + toast in history → ok (fires a real low-urgency probe)', async () => {
  let sent;
  const sendToast = async (n) => { sent = n; return true; };
  const dunstctl = (args) =>
    args[0] === 'history'
      ? { status: 0, stdout: dunstHistory(sent.title, sent.message) }
      : { status: 0, stdout: '' };
  const r = await linuxDeepToastCheck({
    hasBin: (b) => b === 'dunstctl' || b === 'notify-send',
    sendToast, dunstctl, tries: 3, pollMs: 0, sleepFn: async () => {},
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.id, 'toast-deep');
  assert.equal(sent.priority, 'low');           // low-noise, honest probe
  assert.match(sent.title, /doctor check/);
});

test('linuxDeepToastCheck: dunstctl present but nonce missing from history → fail', async () => {
  const sendToast = async () => true;
  const dunstctl = (args) =>
    args[0] === 'history' ? { status: 0, stdout: JSON.stringify({ data: [[]] }) } : { status: 0, stdout: '' };
  const r = await linuxDeepToastCheck({
    hasBin: (b) => b === 'dunstctl' || b === 'notify-send',
    sendToast, dunstctl, tries: 3, pollMs: 0, sleepFn: async () => {},
  });
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /dunst never recorded it/);
});

test('linuxDeepToastCheck: no dunstctl → dispatched-but-unverified info (never a fake pass)', async () => {
  let sent;
  const sendToast = async (n) => { sent = n; return true; };
  const r = await linuxDeepToastCheck({
    hasBin: (b) => b === 'notify-send', // dunstctl absent
    sendToast, dunstctl: () => ({ status: 1, stdout: '' }), tries: 1, pollMs: 0, sleepFn: async () => {},
  });
  assert.equal(r.status, 'info');
  assert.ok(sent, 'a test notification is still dispatched');
  assert.match(r.detail, /dispatched-but-unverified/);
});

test('linuxDeepToastCheck: notify-send fails (no backend) → warn', async () => {
  const r = await linuxDeepToastCheck({
    hasBin: () => true,
    sendToast: async () => false, dunstctl: () => ({ status: 0, stdout: '' }), tries: 1, pollMs: 0, sleepFn: async () => {},
  });
  assert.equal(r.status, 'warn');
  assert.match(r.detail, /notify-send did not exit 0/);
});

function baseConfig() {
  return {
    toast: { enabled: true }, ntfy: { enabled: false, topic: '' },
    webhook: { enabled: false, url: '' }, terminalBell: { enabled: true }, events: {},
  };
}
