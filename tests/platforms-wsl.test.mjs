// tests/platforms-wsl.test.mjs — WSL detection truth table + the Windows-native
// toast backend used under WSL. isWsl is exercised through fully-injected deps so
// the table is deterministic no matter what host runs it — including a real WSL
// shell, where process env and /proc would otherwise leak in and flip cases.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isWsl, sendToast } from '../src/platforms/wsl.mjs';

// A dep bundle that looks like plain (non-WSL) Linux; each case overrides only
// the probe it cares about. Every dep is supplied so the host never leaks in.
function linuxDeps(overrides = {}) {
  return {
    platform: () => 'linux',
    release: () => '5.15.0-generic',
    readFile: () => 'Linux version 5.15.0-generic (gcc)',
    existsSync: () => false,
    env: {},
    ...overrides,
  };
}

describe('isWsl detection truth table (fully injected deps)', () => {
  it('true when the kernel release carries the microsoft tag', () => {
    assert.equal(isWsl(linuxDeps({ release: () => '5.15.167.4-microsoft-standard-WSL2' })), true);
  });

  it('true when only /proc/version carries the microsoft tag', () => {
    assert.equal(isWsl(linuxDeps({ readFile: () => 'Linux version 4.4.0-19041-Microsoft' })), true);
  });

  it('false inside a container even with a microsoft kernel (Docker Desktop guard)', () => {
    const deps = linuxDeps({
      release: () => '5.15.167.4-microsoft-standard-WSL2',
      existsSync: (p) => p === '/.dockerenv',
    });
    assert.equal(isWsl(deps), false);
  });

  it('false inside a container flagged by /run/.containerenv', () => {
    const deps = linuxDeps({
      readFile: () => 'Linux version 5.15.0-microsoft',
      existsSync: (p) => p === '/run/.containerenv',
    });
    assert.equal(isWsl(deps), false);
  });

  it('true via the WSL interop env when a custom kernel drops the tag', () => {
    assert.equal(isWsl(linuxDeps({ env: { WSL_INTEROP: '/run/WSL/8_interop' } })), true);
    assert.equal(isWsl(linuxDeps({ env: { WSL_DISTRO_NAME: 'Ubuntu' } })), true);
  });

  it('true via the binfmt/marker files when a custom kernel drops the tag', () => {
    assert.equal(isWsl(linuxDeps({ existsSync: (p) => p === '/proc/sys/fs/binfmt_misc/WSLInterop' })), true);
    assert.equal(isWsl(linuxDeps({ existsSync: (p) => p === '/run/WSL' })), true);
  });

  it('false on plain Linux with no WSL signal anywhere', () => {
    assert.equal(isWsl(linuxDeps()), false);
  });

  it('false on non-Linux platforms without probing the filesystem', () => {
    let probed = false;
    const deps = linuxDeps({
      platform: () => 'win32',
      release: () => { probed = true; return '10.0.26200'; },
      readFile: () => { probed = true; return ''; },
      existsSync: () => { probed = true; return true; },
    });
    assert.equal(isWsl(deps), false);
    assert.equal(probed, false, 'must short-circuit before touching os/fs probes');
  });

  it('treats throwing probes as absent rather than propagating', () => {
    // release still names microsoft, so detection succeeds despite fs throwing.
    const microsoftReleaseThrowingFs = linuxDeps({
      release: () => '5.15.167.4-microsoft-standard-WSL2',
      readFile: () => { throw new Error('ENOENT'); },
      existsSync: () => { throw new Error('EACCES'); },
    });
    assert.equal(isWsl(microsoftReleaseThrowingFs), true);
    // nothing names microsoft and every probe throws → not WSL, no throw escapes.
    const plainThrowingFs = linuxDeps({
      release: () => { throw new Error('boom'); },
      readFile: () => { throw new Error('ENOENT'); },
      existsSync: () => { throw new Error('EACCES'); },
    });
    assert.equal(isWsl(plainThrowingFs), false);
  });

  it('returns a boolean and never throws with the real host defaults', () => {
    // The Windows/Mac/Linux host running this suite is not our concern here —
    // just prove the bare call is safe with the built-in os/fs primitives.
    assert.equal(typeof isWsl(), 'boolean');
  });
});

describe('wsl sendToast fails gracefully (returns false, never throws)', () => {
  it('resolves false when wslpath/powershell.exe are not reachable', async (t) => {
    // On a real WSL host this would fire a toast, so only assert the negative
    // path off-WSL (Windows/Mac/Linux CI), where wslpath is absent.
    if (isWsl()) return t.skip('running under WSL — would fire a real toast');
    const r = await sendToast({ title: 'T', message: 'M' });
    assert.equal(r, false);
  });
});

// Live delivery under WSL, mirroring platforms.test.mjs's AAN_TOAST_LIVE gate so
// a normal `npm test` never pops a toast; the orchestrator sets it in Wave E.
describe('WSL native toast fires (live — set AAN_TOAST_LIVE=1 inside WSL)', () => {
  const LIVE = process.env.AAN_TOAST_LIVE === '1';
  it('sendToast resolves true from inside WSL', async (t) => {
    if (!LIVE) return t.skip('set AAN_TOAST_LIVE=1 to fire a real toast');
    if (!isWsl()) return t.skip('not running under WSL');
    const r = await sendToast({ title: 'AAN CI', message: 'WSL native toast test' });
    assert.equal(r, true);
  });
});
