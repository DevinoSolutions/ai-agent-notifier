#!/usr/bin/env node
// src/notify.mjs — Entry point called by all AI tool hooks
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseInput } from './parse-input.mjs';
import { route } from './router.mjs';
import { loadConfig } from './config-loader.mjs';
import { sendNtfy } from './ntfy.mjs';

// Deduplication: some tools (Cursor) fire the stop hook twice simultaneously.
// Use exclusive file creation as an atomic lock to ensure only one invocation
// sends notifications per event.
function acquireNotifyLock(source) {
  const dir = path.join(os.homedir(), '.ai-agent-notifier');
  const lockFile = path.join(dir, `.lock-${source}`);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  // Clean up stale locks (>10 seconds old)
  try {
    const stat = fs.statSync(lockFile);
    if (Date.now() - stat.mtimeMs > 10000) fs.unlinkSync(lockFile);
  } catch {}
  // Exclusive create — only the first process wins
  try {
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

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
    if (argv[i] === '--event' && argv[i + 1]) {
      args.event = argv[i + 1];
      i++;
    }
  }
  return args;
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) { resolve('{}'); return; }
    let data = '';
    let resolved = false;
    const done = (val) => { if (!resolved) { resolved = true; resolve(val); } };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => done(data || '{}'));
    // Short timeout: hook callers should pipe data quickly.
    // 500ms is enough for any tool to deliver stdin, avoids blocking notification.
    setTimeout(() => done(data || '{}'), 500);
  });
}

async function main() {
  try {
    const args = parseArgs(process.argv);

    // Deduplicate: if another instance for this source is already running, exit
    if (!acquireNotifyLock(args.source)) {
      process.stdout.write('{}\n');
      process.exit(0);
    }

    const stdinData = await readStdin();
    let raw;
    try { raw = JSON.parse(stdinData); } catch { raw = {}; }

    const event = parseInput(raw, args.source, args.event);
    const config = loadConfig();
    const notification = route(event, config);

    if (!notification) { process.stdout.write('{}\n'); process.exit(0); }

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
  // Write empty JSON response — some tools (Cursor) expect stdout output
  // and may retry the hook if they get nothing.
  process.stdout.write('{}\n');
  process.exit(0);
}

main();
