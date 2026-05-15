// cli/test-cmd.mjs
import os from 'node:os';
import { loadConfig } from '../src/config-loader.mjs';
import { sendNtfy } from '../src/ntfy.mjs';
import { c, spinner, banner } from './ui.mjs';

async function getToastBackend() {
  const platform = os.platform();
  if (platform === 'win32') return (await import('../src/platforms/windows.mjs')).sendToast;
  if (platform === 'darwin') return (await import('../src/platforms/macos.mjs')).sendToast;
  return (await import('../src/platforms/linux.mjs')).sendToast;
}

export async function run(channel) {
  const config = loadConfig();
  const testNotif = {
    title: 'ai-agent-notifier',
    message: 'Test notification \u2014 if you see this, it works!',
    sound: 'Default',
    ntfyPriority: 'default',
    ntfyTags: 'test_tube',
    projectName: 'test',
  };

  console.log();
  console.log(`  ${c.bold('ai-agent-notifier')} ${c.accent('test')}`);
  console.log();

  const doToast = !channel || channel === 'toast' || channel === 'both';
  const doNtfy = !channel || channel === 'ntfy' || channel === 'both';

  if (doToast) {
    const spin = spinner('Sending toast notification...');
    const sendToast = await getToastBackend();
    const ok = await sendToast(testNotif);
    if (ok) {
      spin.stop('Toast sent');
    } else {
      spin.fail('Toast failed');
    }
  }

  if (doNtfy && config.ntfy?.enabled && config.ntfy?.topic) {
    const spin = spinner('Sending ntfy push...');
    const ok = await sendNtfy(config.ntfy, testNotif);
    if (ok) {
      spin.stop('ntfy sent');
    } else {
      spin.fail('ntfy failed');
    }
  } else if (doNtfy && (!config.ntfy?.enabled || !config.ntfy?.topic)) {
    console.log(`  ${c.warn('\u26a0')} ${c.muted('ntfy not configured \u2014 run')} ${c.white('ai-agent-notifier setup')} ${c.muted('first')}`);
  }

  console.log();
}
