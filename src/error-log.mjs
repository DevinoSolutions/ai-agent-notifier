// src/error-log.mjs — Error visibility for the hook path.
// The hook must never crash the host agent, but failures must never be
// invisible either: every error is appended to ~/.ai-agent-notifier/errors.log
// (bounded size), surfaced by `ai-agent-notifier status`, and mirrored to
// Sentry when the user opted in via config.sentry.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sendSentryErrorEvent } from './sentry.mjs';

const MAX_LOG_BYTES = 128 * 1024;

let sentryConfig = null;
const pendingSentrySends = [];

export function getErrorLogPath(baseDir = os.homedir()) {
  return path.join(baseDir, '.ai-agent-notifier', 'errors.log');
}

// Call once per process (from the hook entry point or a CLI command) with
// config.sentry. Until called, errors are logged locally only.
export function enableSentryMirror(config) {
  sentryConfig = config && config.enabled && config.dsn ? config : null;
}

// Append one JSONL entry. Never throws: the logger is the last resort and
// must not become a new failure mode.
export function logHookError(context, error, extra = undefined, baseDir = os.homedir()) {
  const entry = {
    ts: new Date().toISOString(),
    context,
    message: (error && error.message) || String(error),
  };
  if (error && error.stack) entry.stack = String(error.stack).split('\n').slice(0, 4).join('\n');
  if (extra) entry.extra = extra;

  try {
    const logPath = getErrorLogPath(baseDir);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
    rotateIfOversized(logPath);
  } catch {
    // Filesystem unavailable — nothing safer to do.
  }

  if (sentryConfig) {
    pendingSentrySends.push(sendSentryErrorEvent(sentryConfig, { context, error, extra }));
  }
}

// Keep the newest half when the log outgrows MAX_LOG_BYTES.
function rotateIfOversized(logPath) {
  const { size } = fs.statSync(logPath);
  if (size <= MAX_LOG_BYTES) return;
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  const kept = lines.slice(Math.floor(lines.length / 2));
  fs.writeFileSync(logPath, kept.join('\n') + '\n', 'utf8');
}

// Await queued Sentry sends, bounded so a dead network can never stall the
// hook past its budget. Safe to call when nothing is pending.
export async function flushErrorReporting(timeoutMs = 1200) {
  if (pendingSentrySends.length === 0) return;
  const pending = pendingSentrySends.splice(0);
  await Promise.race([
    Promise.allSettled(pending),
    new Promise((resolve) => setTimeout(resolve, timeoutMs).unref?.()),
  ]);
}

// Newest-last recent errors for `status`. Returns [] when there is no log.
export function readRecentHookErrors(limit = 10, baseDir = os.homedir()) {
  try {
    const lines = fs.readFileSync(getErrorLogPath(baseDir), 'utf8').split('\n').filter(Boolean);
    return lines.slice(-limit).map((line) => {
      try { return JSON.parse(line); } catch { return { ts: '', context: 'corrupt-entry', message: line }; }
    });
  } catch {
    return [];
  }
}
