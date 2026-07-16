// tests/doctor.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { runChecks, CHECK_IDS } from '../cli/doctor-checks.mjs';

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
  const results = await runChecks({ config: baseConfig(), deep: true });
  const probe = results.find((r) => r.id === 'deep-probe');
  assert.ok(probe, 'a deep-probe row must be present when --deep is unavailable');
  assert.equal(probe.status, 'info');
  assert.match(probe.detail, /deep verification not available/);
});

function baseConfig() {
  return {
    toast: { enabled: true }, ntfy: { enabled: false, topic: '' },
    webhook: { enabled: false, url: '' }, terminalBell: { enabled: true }, events: {},
  };
}
