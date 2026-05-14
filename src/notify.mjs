#!/usr/bin/env node
// src/notify.mjs — Entry point called by all AI tool hooks
import os from 'node:os';
import { parseInput } from './parse-input.mjs';
import { route } from './router.mjs';
import { loadConfig } from './config-loader.mjs';
import { sendNtfy } from './ntfy.mjs';

async function getToastBackend() {
  const platform = os.platform();
  if (platform === 'win32') return (await import('./platforms/windows.mjs')).sendToast;
  if (platform === 'darwin') return (await import('./platforms/macos.mjs')).sendToast;
  return (await import('./platforms/linux.mjs')).sendToast;
}

function parseArgs(argv) {
  const args = { source: 'claude' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--source' && argv[i + 1]) {
      args.source = argv[i + 1];
      i++;
    }
  }
  return args;
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) { resolve('{}'); return; }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data || '{}'));
    // Timeout: don't hang if stdin never closes
    setTimeout(() => resolve(data || '{}'), 3000);
  });
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    const stdinData = await readStdin();
    let raw;
    try { raw = JSON.parse(stdinData); } catch { raw = {}; }

    const event = parseInput(raw, args.source);
    const config = loadConfig();
    const notification = route(event, config);

    if (!notification) process.exit(0); // unknown event, skip

    // Check per-event overrides
    const eventConfig = config.events?.[event.event] || {};

    const tasks = [];

    // Toast
    if (config.toast?.enabled !== false && eventConfig.toastEnabled !== false) {
      const sendToast = await getToastBackend();
      tasks.push(sendToast(notification));
    }

    // ntfy
    if (config.ntfy?.enabled && config.ntfy?.topic && eventConfig.ntfyEnabled !== false) {
      tasks.push(sendNtfy(config.ntfy, notification));
    }

    await Promise.allSettled(tasks);
  } catch {
    // Never crash — hooks must not block the AI tool
  }
  process.exit(0);
}

main();
