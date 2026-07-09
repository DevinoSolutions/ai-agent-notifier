// cli/config.mjs
import readline from 'node:readline';
import { loadConfigResult, saveConfig, getConfigPath } from '../src/config-loader.mjs';
import { ask, askYN, log, c } from './ui.mjs';

async function configNtfy(rl, config) {
  log('\n  ntfy Configuration\n', 'bold');
  config.ntfy.enabled = await askYN(rl, 'Enable ntfy?', config.ntfy.enabled);
  if (config.ntfy.enabled) {
    config.ntfy.server = await ask(rl, 'Server', config.ntfy.server);
    config.ntfy.topic = await ask(rl, 'Topic', config.ntfy.topic);
    config.ntfy.icon = await ask(rl, 'Icon URL', config.ntfy.icon);
    config.ntfy.click = await ask(rl, 'Click URL', config.ntfy.click);
  }
}

async function configSounds(rl, config) {
  log('\n  Sound Configuration\n', 'bold');
  log('  Windows sounds: Default, IM, Mail, Reminder, SMS, Alarm', 'dim');
  for (const [event, conf] of Object.entries(config.events)) {
    conf.toastSound = await ask(rl, `Sound for ${event}`, conf.toastSound);
  }
}

async function configEvents(rl, config) {
  log('\n  Event Configuration\n', 'bold');
  for (const [event, conf] of Object.entries(config.events)) {
    log(`  ${event}:`, 'cyan');
    conf.toastEnabled = await askYN(rl, '  Enable toast?', conf.toastEnabled !== false);
    conf.ntfyEnabled = await askYN(rl, '  Enable ntfy?', conf.ntfyEnabled !== false);
  }
}

// A Sentry DSN looks like https://<publicKey>@<host>/<projectId>. Validate the
// shape with a plain URL parse plus a non-empty key and project id — enough to
// reject obvious typos loudly without pretending to be a full Sentry client.
function isValidDsn(dsn) {
  if (!dsn || typeof dsn !== 'string') return false;
  let u;
  try { u = new URL(dsn); } catch { return false; }
  const projectId = u.pathname.replace(/\//g, '');
  return (u.protocol === 'https:' || u.protocol === 'http:') && u.username.length > 0 && projectId.length > 0;
}

async function configSentry(rl, config) {
  log('\n  Sentry Configuration\n', 'bold');
  if (!config.sentry) config.sentry = { enabled: false, dsn: '' };
  config.sentry.enabled = await askYN(rl, 'Enable Sentry error reporting?', config.sentry.enabled);
  if (config.sentry.enabled) {
    const dsn = await ask(rl, 'Sentry DSN', config.sentry.dsn);
    if (isValidDsn(dsn)) {
      config.sentry.dsn = dsn;
    } else {
      log('  Invalid DSN — expected https://<key>@<host>/<project>. Sentry left disabled.', 'red');
      config.sentry.enabled = false;
    }
  }
}

export async function run(section) {
  // Interactive-only: bail loudly rather than hang on non-TTY stdin.
  if (!process.stdin.isTTY) {
    log('  this command is interactive — run it in a terminal', 'red');
    process.exitCode = 1;
    return;
  }
  // All answers are collected and written once at the end, so Ctrl+C before that
  // final save leaves the existing config untouched.
  process.on('SIGINT', () => {
    log('\n  aborted — nothing saved', 'red');
    process.exit(130);
  });

  const { config, problem } = loadConfigResult();
  if (problem) {
    console.error(`  ${c.error('Config error:')} ${problem.message}`);
    process.exitCode = 1;
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  if (section === 'ntfy') await configNtfy(rl, config);
  else if (section === 'sounds') await configSounds(rl, config);
  else if (section === 'events') await configEvents(rl, config);
  else if (section === 'sentry') await configSentry(rl, config);
  else {
    log('\n  ai-agent-notifier config\n', 'bold');
    log('  1. ntfy / webhooks');
    log('  2. Sounds');
    log('  3. Events');
    log('  4. Sentry');
    const choice = await ask(rl, 'Choose (1-4)', '1');
    if (choice === '1') await configNtfy(rl, config);
    else if (choice === '2') await configSounds(rl, config);
    else if (choice === '3') await configEvents(rl, config);
    else if (choice === '4') await configSentry(rl, config);
  }

  saveConfig(config, getConfigPath());
  log('\n  ✓ Config saved.\n', 'green');
  rl.close();
}
