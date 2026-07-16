// tests/cli-test.test.mjs — `aan test <channel>` argument validation.
// The unknown-channel path must fail loudly (exit 1) instead of printing the
// header and exiting 0, which reads as a silent success.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, KNOWN_CHANNELS } from '../cli/test.mjs';

test('an unknown channel exits 1 and names the offending value + the valid set', async () => {
  const origErr = console.error;
  const origExit = process.exitCode;
  let msg = '';
  console.error = (s) => { msg += String(s); };
  try {
    process.exitCode = 0;
    await run('slack'); // validated before any config/network work, so this is hermetic
    assert.equal(process.exitCode, 1);
    assert.match(msg, /Unknown channel/);
    assert.match(msg, /slack/);
    assert.match(msg, /toast/); // lists the valid channels
  } finally {
    console.error = origErr;
    process.exitCode = origExit;
  }
});

test('KNOWN_CHANNELS is exactly the documented set', () => {
  assert.deepEqual(KNOWN_CHANNELS, ['toast', 'ntfy', 'webhook', 'bell', 'both']);
});
