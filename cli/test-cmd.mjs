// cli/test-cmd.mjs
import os from 'node:os';
import { loadConfig } from '../src/config-loader.mjs';
import { sendNtfy } from '../src/ntfy.mjs';

function log(msg, color = '') {
  const colors = { green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', reset: '\x1b[0m', bold: '\x1b[1m' };
  console.log(`${colors[color] || ''}${msg}${colors.reset}`);
}

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

  log('\n  ai-agent-notifier test\n', 'bold');

  const doToast = !channel || channel === 'toast' || channel === 'both';
  const doNtfy = !channel || channel === 'ntfy' || channel === 'both';

  if (doToast) {
    log('  Sending test toast...', 'cyan');
    const sendToast = await getToastBackend();
    const ok = await sendToast(testNotif);
    log(ok ? '    \u2713 Toast sent' : '    \u2717 Toast failed', ok ? 'green' : 'red');
  }

  if (doNtfy && config.ntfy?.enabled && config.ntfy?.topic) {
    log('  Sending test ntfy push...', 'cyan');
    const ok = await sendNtfy(config.ntfy, testNotif);
    log(ok ? '    \u2713 ntfy sent' : '    \u2717 ntfy failed', ok ? 'green' : 'red');
  } else if (doNtfy) {
    log('  ntfy not configured \u2014 run "ai-agent-notifier setup" first', 'yellow');
  }

  log('');
}
