#!/usr/bin/env node
// cli/index.mjs
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import https from 'node:https';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const command = process.argv[2];
const subcommand = process.argv[3];

const COMMANDS = {
  setup: () => import('./setup.mjs'),
  status: () => import('./status.mjs'),
  test: () => import('./test-cmd.mjs'),
  config: () => import('./config-cmd.mjs'),
  uninstall: () => import('./uninstall.mjs'),
};

export function checkForUpdate() {
  return new Promise((resolve) => {
    const req = https.get('https://registry.npmjs.org/ai-agent-notifier/latest', { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const latest = JSON.parse(data).version;
          if (latest && latest !== pkg.version) {
            resolve(latest);
          } else {
            resolve(null);
          }
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function main() {
  const { c, banner, gradient } = await import('./ui.mjs');

  if (command === '--version' || command === '-v' || command === '-V') {
    console.log(`${c.bold('ai-agent-notifier')} ${c.accent(`v${pkg.version}`)}`);
    const latest = await checkForUpdate();
    if (latest) {
      console.log(`\n  ${c.warn('\u2191')} ${c.warn(`Update available: v${pkg.version} \u2192 v${latest}`)}`);
      console.log(`    ${c.muted('npm i -g ai-agent-notifier@latest')}`);
    }
    process.exit(0);
  }

  if (!command || command === '--help' || command === '-h') {
    printHelp(c, banner, gradient);
    process.exit(0);
  }

  const loader = COMMANDS[command];
  if (!loader) {
    console.error(`${c.error('Error:')} Unknown command "${command}"\n  Run ${c.muted('ai-agent-notifier --help')} for usage.`);
    process.exit(1);
  }

  const mod = await loader();
  await mod.run(subcommand);
}

function printHelp(c, banner, gradient) {
  console.log();
  console.log(banner());
  console.log(`  ${c.muted('Cross-platform notifications for AI coding agents')}`);
  console.log();
  console.log(`  ${c.bold('Usage:')} ${c.white('ai-agent-notifier')} ${c.accent('<command>')} ${c.muted('[options]')}`);
  console.log();
  console.log(`  ${c.bold('Commands:')}`);
  console.log(`    ${c.accent('setup')}             ${c.white('First-time setup wizard')}`);
  console.log(`    ${c.accent('status')}            ${c.white('Show wired tools, ntfy topic, toast backend')}`);
  console.log(`    ${c.accent('test')} ${c.muted('[channel]')}    ${c.white('Fire test notification')} ${c.muted('(toast | ntfy | both)')}`);
  console.log(`    ${c.accent('config')} ${c.muted('[section]')}  ${c.white('Interactive settings')} ${c.muted('(ntfy | sounds | tools | events)')}`);
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
