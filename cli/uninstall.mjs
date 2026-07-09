// cli/uninstall.mjs
import os from 'node:os';
import readline from 'node:readline';
import path from 'node:path';
import { getConfigDir } from '../src/config-loader.mjs';
import { unpatchAll } from '../setup/patch-config.mjs';
import { c, spinner } from './ui.mjs';

export async function run() {
  // Nothing is written before the confirmation, so Ctrl+C here is a clean abort.
  process.on('SIGINT', () => {
    console.log(`\n  ${c.error('aborted — nothing removed')}`);
    process.exit(130);
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log();
  console.log(`  ${c.bold('ai-agent-notifier')} ${c.accent('uninstall')}`);
  console.log();

  // Resolve on EOF/close too, so a non-TTY stdin can't hang the prompt forever.
  const answer = await new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    rl.question(`  ${c.warn('?')} Remove ai-agent-notifier hooks from all tools? ${c.muted('(y/N)')} `, finish);
    rl.on('close', () => finish(''));
  });

  if (answer.trim().toLowerCase() !== 'y') {
    console.log(`  ${c.muted('Cancelled.')}\n`);
    rl.close();
    return;
  }

  const backupDir = path.join(getConfigDir(), 'backups');
  const spin = spinner('Removing hooks...');
  const results = unpatchAll(os.homedir(), backupDir);
  spin.stop('Processed all tools');

  let anyFailed = false;
  for (const r of results) {
    if (r.ok) {
      console.log(`    ${c.success('✓')} ${c.white(r.tool)} ${c.muted(r.reason)}`);
    } else {
      anyFailed = true;
      console.log(`    ${c.error('✗')} ${c.white(r.tool)} ${c.error(r.reason)}`);
    }
  }

  console.log();
  console.log(`    ${c.muted('Backups saved to')} ${c.white(backupDir)}`);
  console.log(`    ${c.muted('Config at ~/.ai-agent-notifier/ preserved — delete manually if desired.')}`);
  console.log();

  if (anyFailed) process.exitCode = 1;
  rl.close();
}
