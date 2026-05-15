// cli/uninstall.mjs
import os from 'node:os';
import readline from 'node:readline';
import path from 'node:path';
import { getConfigDir } from '../src/config-loader.mjs';
import { unpatchAll } from '../setup/patch-config.mjs';
import { c, spinner } from './ui.mjs';

export async function run() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log();
  console.log(`  ${c.bold('ai-agent-notifier')} ${c.accent('uninstall')}`);
  console.log();

  const answer = await new Promise((resolve) => {
    rl.question(`  ${c.warn('?')} Remove ai-agent-notifier hooks from all tools? ${c.muted('(y/N)')} `, resolve);
  });

  if (answer.trim().toLowerCase() !== 'y') {
    console.log(`  ${c.muted('Cancelled.')}\n`);
    rl.close();
    return;
  }

  const spin = spinner('Removing hooks...');
  const backupDir = path.join(getConfigDir(), 'backups');
  unpatchAll(os.homedir(), backupDir);
  spin.stop('Hooks removed from all tools');

  console.log(`    ${c.muted('Backups saved to')} ${c.white(backupDir)}`);
  console.log(`    ${c.muted('Config at ~/.ai-agent-notifier/ preserved \u2014 delete manually if desired.')}`);
  console.log();

  rl.close();
}
