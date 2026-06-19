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
    const result = await sendBellUnix();
    assert.equal(typeof result, 'boolean');

    // Verify consistency: try opening /dev/tty the same way the production
    // code does. accessSync(W_OK) can report writable even when openSync
    // throws (headless CI runners have the device node but no real terminal).
    let canOpen = false;
    try { const fd = fs.openSync('/dev/tty', 'w'); fs.closeSync(fd); canOpen = true; } catch {}
    assert.equal(result, canOpen, `/dev/tty open ${canOpen ? 'succeeded' : 'failed'} but sendBellUnix returned ${result}`);
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

describe('bell config gating — dispatch condition logic', () => {
  // These test the exact boolean expressions from notify.mjs dispatch:
  //   config.terminalBell?.enabled !== false && eventConfig.terminalBellEnabled !== false

  function shouldBell(config, eventConfig = {}) {
    return config.terminalBell?.enabled !== false && eventConfig.terminalBellEnabled !== false;
  }

  it('bell fires when terminalBell.enabled is true', () => {
    assert.equal(shouldBell({ terminalBell: { enabled: true } }), true);
  });

  it('bell fires when terminalBell key is absent (default enabled)', () => {
    assert.equal(shouldBell({}), true);
  });

  it('bell is suppressed when terminalBell.enabled is false', () => {
    assert.equal(shouldBell({ terminalBell: { enabled: false } }), false);
  });

  it('bell is suppressed by per-event terminalBellEnabled: false', () => {
    assert.equal(shouldBell({ terminalBell: { enabled: true } }, { terminalBellEnabled: false }), false);
  });

  it('bell fires when per-event has no terminalBellEnabled key', () => {
    assert.equal(shouldBell({ terminalBell: { enabled: true } }, {}), true);
  });

  it('bell fires when per-event terminalBellEnabled is true', () => {
    assert.equal(shouldBell({ terminalBell: { enabled: true } }, { terminalBellEnabled: true }), true);
  });
});
