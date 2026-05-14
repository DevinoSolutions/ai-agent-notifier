// cli/uninstall.mjs
import os from 'node:os';
import readline from 'node:readline';
import { getConfigDir } from '../src/config-loader.mjs';
import { unpatchAll } from '../setup/patch-config.mjs';
import path from 'node:path';

function log(msg, color = '') {
  const colors = { green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', reset: '\x1b[0m', bold: '\x1b[1m' };
  console.log(`${colors[color] || ''}${msg}${colors.reset}`);
}

export async function run() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  log('\n  ai-agent-notifier uninstall\n', 'bold');

  const answer = await new Promise((resolve) => {
    rl.question('  ? Remove ai-agent-notifier hooks from all tools? (y/N): ', resolve);
  });

  if (answer.trim().toLowerCase() !== 'y') {
    log('  Cancelled.\n');
    rl.close();
    return;
  }

  const backupDir = path.join(getConfigDir(), 'backups');
  unpatchAll(os.homedir(), backupDir);
  log('  \u2713 Hooks removed from all tools.', 'green');
  log(`  Backups saved to ${backupDir}`, 'dim');
  log('  Config at ~/.ai-agent-notifier/ preserved \u2014 delete manually if desired.\n', 'dim');

  rl.close();
}
