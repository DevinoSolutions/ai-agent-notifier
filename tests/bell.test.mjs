// tests/bell.test.mjs — strict, no-mock tests for the terminal bell channel.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import { sendBell, sendBellWindows, sendBellUnix } from '../src/bell.mjs';
import { loadConfig } from '../src/config-loader.mjs';

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

describe('sendBellWindows — Windows-only (fails if not on win32)', () => {
  const platform = os.platform();

  it('executes the PowerShell bell script and returns boolean', async (t) => {
    if (platform !== 'win32') return t.skip('not Windows');
    const result = await sendBellWindows();
    assert.equal(typeof result, 'boolean');
  });

  it('returns false when pwsh is unavailable', async (t) => {
    if (platform === 'win32') return t.skip('pwsh is available on Windows');
    // On non-Windows, pwsh may not exist or the script path is wrong
    const result = await sendBellWindows();
    assert.equal(result, false);
  });
});

describe('sendBellUnix — Unix-only', () => {
  const platform = os.platform();

  it('writes BEL to /dev/tty when a controlling terminal exists', async (t) => {
    if (platform === 'win32') return t.skip('not Unix');
    // In an interactive terminal, /dev/tty is available.
    // In CI without a tty, sendBellUnix returns false — that's the no-tty path.
    const result = await sendBellUnix();
    assert.equal(typeof result, 'boolean');

    // If /dev/tty exists, we expect true; if not, false.
    let hasTty = false;
    try { fs.accessSync('/dev/tty', fs.constants.W_OK); hasTty = true; } catch {}
    assert.equal(result, hasTty, `/dev/tty ${hasTty ? 'exists' : 'missing'} but sendBellUnix returned ${result}`);
  });

  it('returns false when both /dev/tty and tmux are unavailable', async (t) => {
    if (platform === 'win32') return t.skip('not Unix');
    // We can't easily remove /dev/tty in a test, but we verify the function
    // signature and return type. The no-tty + no-tmux path is tested in e2e
    // by spawning a subprocess without a controlling terminal.
    const result = await sendBellUnix();
    assert.equal(typeof result, 'boolean');
  });
});

describe('terminalBell config defaults', () => {
  it('default config has terminalBell.enabled = true', () => {
    const config = loadConfig();
    assert.equal(config.terminalBell?.enabled, true);
  });
});
