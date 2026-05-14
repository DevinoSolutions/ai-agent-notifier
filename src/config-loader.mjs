import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

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

export function loadConfig(configPath = getConfigPath()) {
  const config = JSON.parse(JSON.stringify(defaults)); // deep clone defaults
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const user = JSON.parse(raw);
    deepMerge(config, user);
  } catch {
    // no user config — use defaults
  }
  return config;
}

export function saveConfig(configPath = getConfigPath(), config) {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}
