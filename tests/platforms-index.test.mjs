// tests/platforms-index.test.mjs — the single toast-backend resolver used by
// the hook path, the CLI test command, and the demo script.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveToastBackend } from '../src/platforms/index.mjs';

describe('resolveToastBackend', () => {
  it('maps each platform to its real backend module', async () => {
    const win = await resolveToastBackend('win32');
    const mac = await resolveToastBackend('darwin');
    // isWsl pinned false so the linux mapping holds even when this suite runs
    // inside WSL (Wave E does exactly that), where the default would flip it.
    const linux = await resolveToastBackend('linux', { isWsl: () => false });
    assert.equal(win, (await import('../src/platforms/windows.mjs')).sendToast);
    assert.equal(mac, (await import('../src/platforms/macos.mjs')).sendToast);
    assert.equal(linux, (await import('../src/platforms/linux.mjs')).sendToast);
  });

  it('routes linux to the WSL backend when running under WSL', async () => {
    const wsl = await resolveToastBackend('linux', { isWsl: () => true });
    assert.equal(wsl, (await import('../src/platforms/wsl.mjs')).sendToast);
  });

  it('treats unknown platforms as linux (notify-send is the portable fallback)', async () => {
    const fallback = await resolveToastBackend('freebsd');
    assert.equal(fallback, (await import('../src/platforms/linux.mjs')).sendToast);
  });
});
