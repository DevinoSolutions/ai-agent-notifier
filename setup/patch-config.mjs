// setup/patch-config.mjs
import fs from 'node:fs';
import path from 'node:path';

const MANAGED_TAG = 'ai-agent-notifier';

function readJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function backup(filePath, backupDir) {
  if (!fs.existsSync(filePath)) return;
  if (!backupDir) return;
  fs.mkdirSync(backupDir, { recursive: true });
  const name = path.basename(filePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(filePath, path.join(backupDir, `${name}.${stamp}.backup`));
}

function makeHookEntry(notifyPath, source, { tag = true, timeout = 10 } = {}) {
  const entry = {
    hooks: [{
      type: 'command',
      command: `node "${notifyPath}" --source ${source}`,
      timeout,
    }],
  };
  if (tag) entry._managed_by = MANAGED_TAG;
  return entry;
}

function removeManagedHooks(hooksArray) {
  if (!Array.isArray(hooksArray)) return [];
  return hooksArray.filter(h => h._managed_by !== MANAGED_TAG &&
    !h.hooks?.some(hh => hh.command?.includes('notify.mjs') && hh.command?.includes('ai-agent-notifier'))
  );
}

export function patchClaude(claudeDir, notifyPath, backupDir) {
  const settingsPath = path.join(claudeDir, 'settings.json');
  backup(settingsPath, backupDir);
  const settings = readJSON(settingsPath) || {};
  if (!settings.hooks) settings.hooks = {};

  const hook = makeHookEntry(notifyPath, 'claude', { timeout: 10 });
  hook.matcher = '';

  settings.hooks.Notification = [...removeManagedHooks(settings.hooks.Notification), hook];
  settings.hooks.Stop = [...removeManagedHooks(settings.hooks.Stop), hook];

  writeJSON(settingsPath, settings);
}

export function patchCodex(codexDir, notifyPath, backupDir) {
  const hooksPath = path.join(codexDir, 'hooks.json');
  backup(hooksPath, backupDir);
  const existing = readJSON(hooksPath) || { hooks: {} };
  if (!existing.hooks) existing.hooks = {};

  // Codex timeout is in seconds
  const stopHook = makeHookEntry(notifyPath, 'codex', { timeout: 10 });
  const permHook = makeHookEntry(notifyPath, 'codex', { timeout: 10 });
  permHook.matcher = '';

  existing.hooks.Stop = [...removeManagedHooks(existing.hooks.Stop), stopHook];
  existing.hooks.PermissionRequest = [...removeManagedHooks(existing.hooks.PermissionRequest), permHook];

  writeJSON(hooksPath, existing);

  // Enable hooks feature flag in config.toml
  // Note: codex_hooks is deprecated since v0.130+, use hooks instead
  const tomlPath = path.join(codexDir, 'config.toml');
  let toml = '';
  try { toml = fs.readFileSync(tomlPath, 'utf8'); } catch { /* new file */ }
  // Migrate deprecated codex_hooks to hooks
  if (toml.includes('codex_hooks')) {
    toml = toml.replace(/codex_hooks\s*=\s*true/, 'hooks = true');
    fs.writeFileSync(tomlPath, toml, 'utf8');
  }
  if (!toml.includes('hooks = true')) {
    if (!toml.includes('[features]')) {
      toml += '\n[features]\nhooks = true\n';
    } else {
      toml = toml.replace('[features]', '[features]\nhooks = true');
    }
    fs.writeFileSync(tomlPath, toml, 'utf8');
  }
}

export function patchCursor(cursorDir, notifyPath, backupDir) {
  const hooksPath = path.join(cursorDir, 'hooks.json');
  backup(hooksPath, backupDir);
  const existing = readJSON(hooksPath) || { hooks: {} };
  if (!existing.hooks) existing.hooks = {};

  // Cursor timeout is in seconds (same as Claude Code)
  const hook = makeHookEntry(notifyPath, 'cursor', { timeout: 10 });

  existing.hooks.stop = [...removeManagedHooks(existing.hooks.stop), hook];
  existing.hooks.notification = [...removeManagedHooks(existing.hooks.notification), hook];

  writeJSON(hooksPath, existing);
}

export function patchGemini(geminiDir, notifyPath, backupDir) {
  // Gemini CLI reads hooks from settings.json, NOT hooks.json
  const settingsPath = path.join(geminiDir, 'settings.json');
  backup(settingsPath, backupDir);
  const settings = readJSON(settingsPath) || {};
  if (!settings.hooks) settings.hooks = {};

  // Gemini timeout is in milliseconds (default 60000)
  const hook = makeHookEntry(notifyPath, 'gemini', { timeout: 30000 });

  settings.hooks.AfterAgent = [...removeManagedHooks(settings.hooks.AfterAgent), hook];
  settings.hooks.Notification = [...removeManagedHooks(settings.hooks.Notification), hook];

  writeJSON(settingsPath, settings);

  // Clean up stale hooks.json if we created one previously
  const staleHooksPath = path.join(geminiDir, 'hooks.json');
  const staleData = readJSON(staleHooksPath);
  if (staleData?.hooks) {
    let changed = false;
    for (const event of ['AfterAgent', 'Notification']) {
      if (staleData.hooks[event]) {
        staleData.hooks[event] = removeManagedHooks(staleData.hooks[event]);
        if (staleData.hooks[event].length === 0) delete staleData.hooks[event];
        changed = true;
      }
    }
    if (changed) {
      if (Object.keys(staleData.hooks).length === 0) {
        try { fs.unlinkSync(staleHooksPath); } catch { /* ignore */ }
      } else {
        writeJSON(staleHooksPath, staleData);
      }
    }
  }
}

export function unpatchAll(homeDir, backupDir) {
  const tools = [
    { dir: '.claude', file: 'settings.json', events: ['Notification', 'Stop'] },
    { dir: '.codex', file: 'hooks.json', events: ['Stop', 'PermissionRequest'] },
    { dir: '.cursor', file: 'hooks.json', events: ['stop', 'notification'] },
    { dir: '.gemini', file: 'settings.json', events: ['AfterAgent', 'Notification'] },
  ];

  for (const tool of tools) {
    const filePath = path.join(homeDir, tool.dir, tool.file);
    const data = readJSON(filePath);
    if (!data?.hooks) continue;
    backup(filePath, backupDir);
    for (const event of tool.events) {
      if (data.hooks[event]) {
        data.hooks[event] = removeManagedHooks(data.hooks[event]);
        if (data.hooks[event].length === 0) delete data.hooks[event];
      }
    }
    writeJSON(filePath, data);
  }
}
