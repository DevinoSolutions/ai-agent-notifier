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
  if (command === '--version' || command === '-v' || command === '-V') {
    console.log(`ai-agent-notifier v${pkg.version}`);
    const latest = await checkForUpdate();
    if (latest) {
      console.log(`\n  Update available: v${pkg.version} → v${latest}`);
      console.log(`  Run: npm i -g ai-agent-notifier@latest`);
    }
    process.exit(0);
  }

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  const loader = COMMANDS[command];
  if (!loader) {
    console.error(`Unknown command: ${command}\nRun "ai-agent-notifier --help" for usage.`);
    process.exit(1);
  }

  const mod = await loader();
  await mod.run(subcommand);
}

function printHelp() {
  console.log(`
  ai-agent-notifier — cross-platform notifications for AI coding agents

  Usage: ai-agent-notifier <command> [options]

  Commands:
    setup             First-time setup wizard
    status            Show wired tools, ntfy topic, toast backend
    test [channel]    Fire test notification (toast | ntfy | both)
    config [section]  Interactive settings (ntfy | sounds | tools | events)
    uninstall         Remove hooks from all tools
    --version, -v     Show version and check for updates

  Examples:
    npx ai-agent-notifier setup
    ai-agent-notifier test toast
    ai-agent-notifier config ntfy
  `);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
