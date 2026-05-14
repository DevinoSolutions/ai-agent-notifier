#!/usr/bin/env node
// cli/index.mjs
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const command = process.argv[2];
const subcommand = process.argv[3];

const COMMANDS = {
  setup: () => import('./setup.mjs'),
  status: () => import('./status.mjs'),
  test: () => import('./test-cmd.mjs'),
  config: () => import('./config-cmd.mjs'),
  uninstall: () => import('./uninstall.mjs'),
};

async function main() {
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
