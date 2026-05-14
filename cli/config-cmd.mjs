// cli/config-cmd.mjs
import readline from 'node:readline';
import { loadConfig, saveConfig, getConfigPath } from '../src/config-loader.mjs';

function log(msg, color = '') {
  const colors = { green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', reset: '\x1b[0m', bold: '\x1b[1m' };
  console.log(`${colors[color] || ''}${msg}${colors.reset}`);
}

function ask(rl, question, defaultVal) {
  return new Promise((resolve) => {
    const suffix = defaultVal ? ` (${defaultVal})` : '';
    rl.question(`  ? ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

function askYN(rl, question, defaultYes = true) {
  return new Promise((resolve) => {
    const hint = defaultYes ? '(Y/n)' : '(y/N)';
    rl.question(`  ? ${question} ${hint}: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (!a) { resolve(defaultYes); return; }
      resolve(a === 'y' || a === 'yes');
    });
  });
}

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
    conf.sound = await ask(rl, `Sound for ${event}`, conf.sound);
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

export async function run(section) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const config = loadConfig();

  if (section === 'ntfy') await configNtfy(rl, config);
  else if (section === 'sounds') await configSounds(rl, config);
  else if (section === 'events') await configEvents(rl, config);
  else {
    log('\n  ai-agent-notifier config\n', 'bold');
    log('  1. ntfy / webhooks');
    log('  2. Sounds');
    log('  3. Events');
    const choice = await ask(rl, 'Choose (1-3)', '1');
    if (choice === '1') await configNtfy(rl, config);
    else if (choice === '2') await configSounds(rl, config);
    else if (choice === '3') await configEvents(rl, config);
  }

  saveConfig(getConfigPath(), config);
  log('\n  \u2713 Config saved.\n', 'green');
  rl.close();
}
