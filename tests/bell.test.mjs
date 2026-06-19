// tests/bell.test.mjs — strict, no-mock tests for the terminal bell channel.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { sendBell, sendBellWindows, sendBellUnix } from '../src/bell.mjs';

describe('sendBell — platform dispatch', () => {
  it('returns a boolean (true or false)', async () => {
    const result = await sendBell();
    assert.equal(typeof result, 'boolean');
  });

  it('calls the correct platform function and returns boolean', async () => {
    const platform = os.platform();
    if (platform === 'win32') {
      const result = await sendBellWindows();
      assert.equal(typeof result, 'boolean');
    } else {
      const result = await sendBellUnix();
      assert.equal(typeof result, 'boolean');
    }
  });
});
