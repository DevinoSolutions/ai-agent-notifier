// tests/platforms-index.test.mjs — the single toast-backend resolver used by
// the hook path, the CLI test command, and the demo script.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveToastBackend } from '../src/platforms/index.mjs';

describe('resolveToastBackend', () => {
  it('maps each platform to its real backend module', async () => {
    const win = await resolveToastBackend('win32');
    const mac = await resolveToastBackend('darwin');
    const linux = await resolveToastBackend('linux');
    assert.equal(win, (await import('../src/platforms/windows.mjs')).sendToast);
    assert.equal(mac, (await import('../src/platforms/macos.mjs')).sendToast);
    assert.equal(linux, (await import('../src/platforms/linux.mjs')).sendToast);
  });

  it('treats unknown platforms as linux (notify-send is the portable fallback)', async () => {
    const fallback = await resolveToastBackend('freebsd');
    assert.equal(fallback, (await import('../src/platforms/linux.mjs')).sendToast);
  });
});
