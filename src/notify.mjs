#!/usr/bin/env node
// src/notify.mjs — Entry point called by all AI tool hooks
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInput } from './parse-input.mjs';
import { route } from './router.mjs';
import { loadConfig } from './config-loader.mjs';
import { sendNtfy } from './ntfy.mjs';
import { sendBell } from './bell.mjs';
import { resolveToastBackend } from './platforms/index.mjs';
import { enableSentryMirror, logHookError, flushErrorReporting } from './error-log.mjs';

// Some tools (Cursor) fire the same hook twice simultaneously. Exclusive file
// creation is the atomic lock that lets only one invocation notify. The key
// includes event (and session when present) so DISTINCT events — e.g. a
// task_complete followed seconds later by a needs_input — never suppress each
// other; only true double-fires of the same event collide.
const DEDUP_WINDOW_MS = 1500;

export function dedupKey(event) {
  const sessionSuffix = event.sessionId ? `-${event.sessionId.slice(0, 8)}` : '';
  return `${event.source}-${event.event}${sessionSuffix}`.replace(/[^A-Za-z0-9_.-]/g, '_');
}

export function acquireNotifyLock(key, baseDir = os.homedir()) {
  const dir = path.join(baseDir, '.ai-agent-notifier');
  const lockFile = path.join(dir, `.lock-${key}`);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  // Clean up locks older than the dedup window (locks are never released —
  // the short window makes that harmless)
  try {
    const stat = fs.statSync(lockFile);
    if (Date.now() - stat.mtimeMs > DEDUP_WINDOW_MS) fs.unlinkSync(lockFile);
  } catch {}
  // Exclusive create — only the first process wins
  try {
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch (err) {
    // EEXIST is the one true duplicate signal (a concurrent invocation won the
    // exclusive create). Any other failure — read-only HOME, ENOTDIR, quota —
    // fails OPEN: a rare double notification beats never notifying again.
    return err?.code !== 'EEXIST';
  }
}

export function parseArgs(argv) {
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

// Run one channel send. Senders resolve booleans and log their own failure
// detail at the source; this wrapper only has to catch unexpected throws so
// one broken channel can never take down the others.
function trackChannel(channel, promise) {
  return promise.then(
    (ok) => ({ channel, ok }),
    (err) => { logHookError(channel, err); return { channel, ok: false }; },
  );
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    const stdinData = await readStdin();

    let raw;
    try {
      raw = JSON.parse(stdinData);
    } catch {
      raw = {};
      logHookError('stdin', new Error('malformed hook stdin JSON'), { source: args.source, bytes: stdinData.length });
    }

    const event = parseInput(raw, args.source, args.event);
    const config = loadConfig();
    enableSentryMirror(config.sentry);

    // Deduplicate AFTER parsing so the lock can key on source+event+session
    if (!acquireNotifyLock(dedupKey(event))) {
      await flushErrorReporting();
      process.stdout.write('{}\n');
      process.exit(0);
    }

    const notification = route(event, config);
    if (!notification) {
      // A hook fired an event we don't map to any notification. That's either
      // wiring pointed at the wrong event or a tool's new event type — say so
      // in errors.log (surfaced by `status`) instead of exiting silently.
      logHookError('router', new Error(`hook event '${event.rawEvent || '(none)'}' from ${event.source} is not mapped to a notification`), {
        rawEvent: event.rawEvent,
        source: event.source,
      });
      await flushErrorReporting();
      process.stdout.write('{}\n');
      process.exit(0);
    }

    // Check per-event overrides
    const eventConfig = config.events?.[event.event] || {};

    const tasks = [];

    // Toast
    if (config.toast?.enabled !== false && eventConfig.toastEnabled !== false) {
      const sendToast = await resolveToastBackend();
      tasks.push(trackChannel('toast', sendToast(notification)));
    }

    // ntfy
    if (config.ntfy?.enabled && config.ntfy?.topic && eventConfig.ntfyEnabled !== false) {
      tasks.push(trackChannel('ntfy', sendNtfy(config.ntfy, notification)));
    }

    // Terminal bell (best-effort by design: `ok: false` here usually just
    // means "no controlling terminal", so only unexpected throws are logged)
    if (config.terminalBell?.enabled !== false && eventConfig.terminalBellEnabled !== false) {
      tasks.push(trackChannel('bell', sendBell()));
    }

    await Promise.all(tasks);
  } catch (err) {
    // Never crash — hooks must not block the AI tool. But never hide it
    // either: errors.log + `status` (+ Sentry when enabled) make it visible.
    logHookError('hook', err);
  }
  await flushErrorReporting();
  // Write empty JSON response — some tools (Cursor) expect stdout output
  // and may retry the hook if they get nothing.
  process.stdout.write('{}\n');
  process.exit(0);
}

// Only run main when invoked directly as a hook (node src/notify.mjs ...),
// not when imported by tests for unit-testing the real exported functions.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
