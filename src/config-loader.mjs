import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { logHookError } from './error-log.mjs';

const require = createRequire(import.meta.url);
const defaults = require('../config/default-config.json');

// Deep merge b into a (a is mutated)
function deepMerge(a, b) {
  for (const key of Object.keys(b)) {
    if (
      b[key] && typeof b[key] === 'object' && !Array.isArray(b[key]) &&
      a[key] && typeof a[key] === 'object' && !Array.isArray(a[key])
    ) {
      deepMerge(a[key], b[key]);
    } else {
      a[key] = b[key];
    }
  }
  return a;
}

export function getConfigDir() {
  return path.join(os.homedir(), '.ai-agent-notifier');
}

export function getConfigPath() {
  return path.join(getConfigDir(), 'config.json');
}

const EVENT_OVERRIDE_TYPES = {
  toastSound: 'string',
  priority: 'string',
  ntfyTags: 'string',
  toastEnabled: 'boolean',
  ntfyEnabled: 'boolean',
  terminalBellEnabled: 'boolean',
  webhookEnabled: 'boolean',
};
const RENAMED_KEYS = {
  sound: 'toastSound',
  ntfyPriority: 'priority',
};
const PRIORITY_VALUES = ['min', 'low', 'default', 'high', 'urgent'];
const FORMAT_VALUES = ['generic', 'slack', 'discord', 'telegram'];

// Shallow schema check. Wrong-typed keys are DELETED from the user object
// (defaults win) and reported, so a bad value can never poison the runtime.
// Unknown keys are reported but kept — they are usually typos.
function validateUserConfig(user) {
  const issues = [];
  const checkBlock = (blockName, spec) => {
    const block = user[blockName];
    if (block === undefined) return;
    if (typeof block !== 'object' || block === null || Array.isArray(block)) {
      issues.push(`"${blockName}" must be an object`);
      delete user[blockName];
      return;
    }
    for (const [key, val] of Object.entries(block)) {
      const expected = spec[key];
      if (!expected) { issues.push(`unknown key "${blockName}.${key}"`); continue; }
      if (typeof val !== expected) {
        issues.push(`"${blockName}.${key}" must be a ${expected}, got ${typeof val}`);
        delete block[key];
      }
    }
  };

  checkBlock('ntfy', { enabled: 'boolean', server: 'string', topic: 'string', click: 'string', icon: 'string', richContent: 'boolean' });
  checkBlock('toast', { enabled: 'boolean', clickToFocus: 'boolean', richContent: 'boolean' });
  checkBlock('terminalBell', { enabled: 'boolean' });
  checkBlock('webhook', { enabled: 'boolean', url: 'string', format: 'string', chatId: 'string', authorization: 'string', richContent: 'boolean' });
  checkBlock('sentry', { enabled: 'boolean', dsn: 'string' });

  // Webhook format is a fixed preset enum (like event priority): an invalid
  // value is dropped so the 'generic' default wins. Telegram addresses the
  // message by chatId — flag its absence but keep the format so the missing
  // chatId surfaces as a logged hint at send time, not a silent drop.
  const webhook = user.webhook;
  if (webhook && typeof webhook === 'object' && !Array.isArray(webhook)) {
    if (typeof webhook.format === 'string' && !FORMAT_VALUES.includes(webhook.format)) {
      issues.push(`"webhook.format" must be one of ${FORMAT_VALUES.join('|')}, got "${webhook.format}"`);
      delete webhook.format;
    }
    if (webhook.format === 'telegram' && !webhook.chatId) {
      issues.push('"webhook.format" is "telegram" but "webhook.chatId" is missing');
    }
  }

  if (user.events !== undefined) {
    if (typeof user.events !== 'object' || user.events === null) {
      issues.push('"events" must be an object');
      delete user.events;
    } else {
      for (const [eventName, overrides] of Object.entries(user.events)) {
        if (typeof overrides !== 'object' || overrides === null) {
          issues.push(`"events.${eventName}" must be an object`);
          delete user.events[eventName];
          continue;
        }
        for (const [key, val] of Object.entries(overrides)) {
          if (RENAMED_KEYS[key]) {
            issues.push(`"events.${eventName}.${key}" was renamed to "${RENAMED_KEYS[key]}" — update your config.json`);
            continue;
          }
          const expected = EVENT_OVERRIDE_TYPES[key];
          if (!expected) { issues.push(`unknown key "events.${eventName}.${key}"`); continue; }
          if (typeof val !== expected) {
            issues.push(`"events.${eventName}.${key}" must be a ${expected}, got ${typeof val}`);
            delete overrides[key];
          } else if (key === 'priority' && !PRIORITY_VALUES.includes(val)) {
            issues.push(`"events.${eventName}.priority" must be one of ${PRIORITY_VALUES.join('|')}, got "${val}"`);
            delete overrides[key];
          }
        }
      }
    }
  }

  const knownTop = ['ntfy', 'toast', 'terminalBell', 'webhook', 'sentry', 'events', 'sources'];
  for (const key of Object.keys(user)) {
    if (!knownTop.includes(key)) issues.push(`unknown key "${key}"`);
  }
  return issues;
}

// Load defaults + user config, reporting exactly what is wrong with the user
// file instead of silently pretending it does not exist.
// problem: null | { type: 'read'|'parse'|'validate', message: string }
export function loadConfigResult(configPath = getConfigPath()) {
  const config = JSON.parse(JSON.stringify(defaults)); // deep clone defaults

  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { config, problem: null }; // no user config — defaults are the contract
    return { config, problem: { type: 'read', message: `cannot read ${configPath}: ${err.message}` } };
  }

  let user;
  try {
    user = JSON.parse(raw);
  } catch (err) {
    return { config, problem: { type: 'parse', message: `${configPath} is not valid JSON (${err.message}) — using defaults` } };
  }

  const issues = validateUserConfig(user);
  deepMerge(config, user);
  const problem = issues.length
    ? { type: 'validate', message: `${configPath}: ${issues.join('; ')}` }
    : null;
  return { config, problem };
}

// Hook-path loader: never throws, but a broken user config is logged to
// errors.log (and Sentry when enabled) instead of being silently ignored.
// CLI commands should prefer loadConfigResult and fail loud on problem.
export function loadConfig(configPath = getConfigPath()) {
  const { config, problem } = loadConfigResult(configPath);
  if (problem) logHookError(`config:${problem.type}`, new Error(problem.message));
  return config;
}

// Atomic write: temp file + rename so a crash mid-write can never leave a
// truncated config.json behind.
export function saveConfig(config, configPath = getConfigPath()) {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, configPath);
}
