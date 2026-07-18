// cli/test.mjs
import { loadConfigResult } from '../src/config-loader.mjs';
import { sendNtfy } from '../src/ntfy.mjs';
import { sendWebhook } from '../src/webhook.mjs';
import { resolveToastBackend } from '../src/platforms/index.mjs';
import { sendBell } from '../src/bell.mjs';
import { c, spinner } from './ui.mjs';

// The channels `test` understands. Omitting the arg runs all applicable ones;
// `both` is the documented toast+ntfy shorthand. An unrecognised value used to
// print the header and exit 0 doing nothing, which reads as a silent success.
export const KNOWN_CHANNELS = ['toast', 'ntfy', 'webhook', 'bell', 'both'];

export async function run(channel) {
  if (channel && !KNOWN_CHANNELS.includes(channel)) {
    console.error(`  ${c.error('Unknown channel:')} ${channel} ${c.muted(`(valid: ${KNOWN_CHANNELS.join(', ')})`)}`);
    process.exitCode = 1;
    return;
  }

  const { config, problem } = loadConfigResult();
  if (problem) {
    console.error(`  ${c.error('Config error:')} ${problem.message}`);
    process.exitCode = 1;
    return;
  }

  const testNotif = {
    title: 'anotifier',
    message: 'Test notification — if you see this, it works!',
    toastSound: 'Default',
    priority: 'default',
    ntfyTags: 'test_tube',
    projectName: 'test',
  };

  console.log();
  console.log(`  ${c.bold('anotifier')} ${c.accent('test')}`);
  console.log();

  const doToast = !channel || channel === 'toast' || channel === 'both';
  const doNtfy = !channel || channel === 'ntfy' || channel === 'both';
  // Webhook is off by default, so the all-channels run only touches it when the
  // user has enabled it (unlike ntfy, which defaults on). Explicit `test webhook`
  // always runs it and reports "not configured" if it isn't set up.
  const doWebhook = channel === 'webhook' || (!channel && config.webhook?.enabled);
  const doBell = !channel || channel === 'bell';

  // A tested channel that fails to deliver must fail the command (exit 1) — bell
  // is exempt (see below), so only toast/ntfy flip this.
  let failed = false;

  if (doToast) {
    const spin = spinner('Sending toast notification...');
    const sendToast = await resolveToastBackend();
    const ok = await sendToast(testNotif);
    if (ok) spin.stop('Toast sent');
    else { spin.fail('Toast failed'); failed = true; }
  }

  if (doNtfy) {
    if (config.ntfy?.enabled && config.ntfy?.topic) {
      const spin = spinner('Sending ntfy push...');
      const ok = await sendNtfy(config.ntfy, testNotif);
      if (ok) spin.stop('ntfy sent');
      else { spin.fail('ntfy failed'); failed = true; }
    } else {
      console.log(`  ${c.warn('⚠')} ${c.muted('ntfy not configured — run')} ${c.white('anotifier setup')} ${c.muted('first')}`);
    }
  }

  if (doWebhook) {
    if (config.webhook?.enabled && config.webhook?.url) {
      const spin = spinner('Sending webhook...');
      const ok = await sendWebhook(config.webhook, testNotif);
      if (ok) spin.stop('Webhook sent');
      else { spin.fail('Webhook failed'); failed = true; }
    } else {
      console.log(`  ${c.warn('⚠')} ${c.muted('webhook not configured — run')} ${c.white('anotifier config')} ${c.muted('first')}`);
    }
  }

  if (doBell) {
    const spin = spinner('Ringing terminal bell...');
    const ok = await sendBell();
    if (ok) {
      spin.stop('Bell rung');
    } else {
      // Bell is best-effort: `false` almost always means "no controlling terminal"
      // (no TTY / no /dev/tty), which is not a real failure. Warn, but never exit 1.
      spin.warn(c.muted('Bell skipped — no controlling terminal (best-effort channel)'));
    }
  }

  if (failed) process.exitCode = 1;
  console.log();
}
