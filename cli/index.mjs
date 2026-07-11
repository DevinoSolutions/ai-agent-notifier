#!/usr/bin/env node
// cli/index.mjs
import { createRequire } from 'node:module';
import { checkForUpdate } from './update-check.mjs';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const command = process.argv[2];
const subcommand = process.argv[3];

const COMMANDS = {
  setup: () => import('./setup.mjs'),
  status: () => import('./status.mjs'),
  test: () => import('./test.mjs'),
  config: () => import('./config.mjs'),
  doctor: () => import('./doctor.mjs'),
  uninstall: () => import('./uninstall.mjs'),
};

async function printUpdateBanner(c, updatePromise) {
  const latest = await updatePromise;
  if (latest) {
    console.log(`  ${c.warn('↑')} ${c.warn(`Update available: v${pkg.version} → v${latest}`)}`);
    console.log(`    ${c.muted('npm i -g ai-agent-notifier@latest')}\n`);
  }
}

async function main() {
  const { c, banner } = await import('./ui.mjs');

  // Fire the (cached, at most one/day) update check once for this run. status
  // shares the same memoized promise, so no command makes a second request.
  const updatePromise = checkForUpdate();

  if (command === '--version' || command === '-v' || command === '-V') {
    console.log(`${c.bold('ai-agent-notifier')} ${c.accent(`v${pkg.version}`)}`);
    await printUpdateBanner(c, updatePromise);
    process.exit(0);
  }

  if (!command || command === '--help' || command === '-h') {
    printHelp(c, banner);
    await printUpdateBanner(c, updatePromise);
    process.exit(0);
  }

  const loader = COMMANDS[command];
  if (!loader) {
    console.error(`${c.error('Error:')} Unknown command "${command}"\n  Run ${c.muted('ai-agent-notifier --help')} for usage.`);
    process.exit(1);
  }

  const mod = await loader();
  await mod.run(...process.argv.slice(3));

  // Show update banner after command output. status prints its own; doctor
  // --json must stay machine-parseable (valid JSON only), so suppress it there.
  const suppressBanner = command === 'status'
    || (command === 'doctor' && process.argv.slice(3).includes('--json'));
  if (!suppressBanner) {
    await printUpdateBanner(c, updatePromise);
  }
}

function printHelp(c, banner) {
  console.log();
  console.log(banner());
  console.log(`  ${c.muted('Cross-platform notifications for AI coding agents')}`);
  console.log();
  console.log(`  ${c.bold('Usage:')} ${c.white('ai-agent-notifier')} ${c.accent('<command>')} ${c.muted('[options]')}`);
  console.log();
  console.log(`  ${c.bold('Commands:')}`);
  console.log(`    ${c.accent('setup')}             ${c.white('First-time setup wizard')}`);
  console.log(`    ${c.accent('status')}            ${c.white('Show wired tools, ntfy topic, toast backend')}`);
  console.log(`    ${c.accent('test')} ${c.muted('[channel]')}    ${c.white('Fire test notification')} ${c.muted('(toast | ntfy | webhook | bell | both)')}`);
  console.log(`    ${c.accent('config')} ${c.muted('[section]')}  ${c.white('Interactive settings')} ${c.muted('(ntfy | webhook | sounds | events | sentry)')}`);
  console.log(`    ${c.accent('doctor')} ${c.muted('[--deep]')}   ${c.white('Diagnose delivery per channel')} ${c.muted('(--deep verifies real delivery)')}`);
  console.log(`    ${c.accent('uninstall')}         ${c.white('Remove hooks from all tools')}`);
  console.log(`    ${c.muted('--version, -v')}     ${c.white('Show version and check for updates')}`);
  console.log();
  console.log(`  ${c.bold('Examples:')}`);
  console.log(`    ${c.muted('$')} ${c.white('npx ai-agent-notifier setup')}`);
  console.log(`    ${c.muted('$')} ${c.white('ai-agent-notifier test toast')}`);
  console.log(`    ${c.muted('$')} ${c.white('ai-agent-notifier config ntfy')}`);
  console.log();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
