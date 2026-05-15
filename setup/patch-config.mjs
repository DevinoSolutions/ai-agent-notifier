// setup/patch-config.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
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

function makeHookEntry(notifyPath, source, { tag = true, timeout = 10, statusMessage, event } = {}) {
  let cmd = `node "${notifyPath}" --source ${source}`;
  // Pass --event for tools that don't include hook_event_name in stdin (Codex, Cursor).
  // Claude and Gemini include it in stdin JSON, so --event is unnecessary for them.
  if (event) cmd += ` --event ${event}`;
  const hookHandler = {
    type: 'command',
    command: cmd,
    timeout,
  };
  if (statusMessage) hookHandler.statusMessage = statusMessage;
  const entry = { hooks: [hookHandler] };
  // Only add _managed_by for tools that support extra fields (Claude Code).
  // Codex and Cursor use strict schema validation — extra fields cause silent rejection.
  if (tag) entry._managed_by = MANAGED_TAG;
  return entry;
}

function isOurHook(command) {
  return command?.includes('notify.mjs') &&
    (command.includes('ai-agent-notifier') || command.includes('agent-notify'));
}

function removeManagedHooks(hooksArray) {
  if (!Array.isArray(hooksArray)) return [];
  return hooksArray.filter(h => h._managed_by !== MANAGED_TAG &&
    // Claude/Codex nested format: { hooks: [{ command: "...notify.mjs..." }] }
    !h.hooks?.some(hh => isOurHook(hh.command)) &&
    // Cursor flat format: { command: "...notify.mjs..." }
    !isOurHook(h.command)
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

// Compute Codex hook trust hash. Codex uses SHA-256 of canonicalized JSON
// derived from a NormalizedHookIdentity struct:
//   { event_name, [matcher], hooks: [handler] }   (MatcherGroup is flattened)
// where handler is HookHandlerConfig::Command with serde renames.
//
// Pipeline: struct → Serialize to TOML value → convert to JSON → canonical sort → SHA-256
// TOML has no null: Option::None fields are OMITTED (not included as null).
// Serde renames: timeout_sec→"timeout", status_message→"statusMessage",
//                command_windows→"commandWindows", async stays "async".
function canonicalJson(val) {
  if (val === null || val === undefined) return JSON.stringify(null);
  if (typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) return '[' + val.map(canonicalJson).join(',') + ']';
  const sorted = Object.keys(val).sort();
  return '{' + sorted.map(k => JSON.stringify(k) + ':' + canonicalJson(val[k])).join(',') + '}';
}

function codexHookHash(eventName, command, { timeout, matcher, isAsync = false, statusMessage } = {}) {
  // Build handler with only fields that Codex includes after TOML serialization.
  // Option::None fields are OMITTED (TOML has no null), bool/int always included.
  const handler = {
    async: isAsync,
    command,
    timeout: Math.max(1, timeout ?? 600),
    type: 'command',
  };
  // Only include optional fields when they have values (TOML omits None)
  if (statusMessage != null) handler.statusMessage = statusMessage;
  // commandWindows is always None in normalized form → omitted

  // Build identity: event_name + flattened MatcherGroup
  const identity = { event_name: eventName, hooks: [handler] };
  // matcher only included when Some (not None)
  if (matcher != null) identity.matcher = matcher;

  const json = canonicalJson(identity);
  const hash = crypto.createHash('sha256').update(json).digest('hex');
  return `sha256:${hash}`;
}

export function patchCodex(codexDir, notifyPath, backupDir) {
  const hooksPath = path.join(codexDir, 'hooks.json');
  backup(hooksPath, backupDir);
  const existing = readJSON(hooksPath) || { hooks: {} };
  if (!existing.hooks) existing.hooks = {};

  // Codex (Rust) may use sh/bash to execute hook commands on Windows.
  // Forward slashes avoid shell escape issues and work on all platforms.
  const safePath = notifyPath.replace(/\\/g, '/');

  // Codex uses strict schema — no _managed_by, must include statusMessage.
  // Timeout is in seconds. Hooks only fire in interactive TUI (not exec mode).
  const stopHook = makeHookEntry(safePath, 'codex', {
    tag: false, timeout: 10, statusMessage: 'Sending notification', event: 'Stop',
  });
  const sessionStartHook = makeHookEntry(safePath, 'codex', {
    tag: false, timeout: 10, statusMessage: 'Sending notification', event: 'SessionStart',
  });

  existing.hooks.Stop = [...removeManagedHooks(existing.hooks.Stop), stopHook];
  existing.hooks.SessionStart = [...removeManagedHooks(existing.hooks.SessionStart), sessionStartHook];

  writeJSON(hooksPath, existing);

  // Compute trust hashes so Codex CLI auto-trusts hooks without prompting.
  // Codex stores trusted_hash in config.toml under [hooks.state.<key>].
  // Without matching hashes, unmanaged hooks are silently skipped.
  const stopCmd = stopHook.hooks[0].command;
  const sessionCmd = sessionStartHook.hooks[0].command;
  const stopIdx = existing.hooks.Stop.length - 1;
  const sessionIdx = existing.hooks.SessionStart.length - 1;

  const hashOpts = { timeout: 10, statusMessage: 'Sending notification' };
  const trustEntries = [
    { key: `${hooksPath}:stop:${stopIdx}:0`, hash: codexHookHash('stop', stopCmd, hashOpts) },
    { key: `${hooksPath}:session_start:${sessionIdx}:0`, hash: codexHookHash('session_start', sessionCmd, hashOpts) },
  ];

  // Enable hooks feature flag in config.toml
  const tomlPath = path.join(codexDir, 'config.toml');
  let toml = '';
  try { toml = fs.readFileSync(tomlPath, 'utf8'); } catch { /* new file */ }
  // Migrate deprecated codex_hooks to hooks
  if (toml.includes('codex_hooks')) {
    toml = toml.replace(/codex_hooks\s*=\s*true/, 'hooks = true');
  }
  if (!toml.includes('hooks = true')) {
    if (!toml.includes('[features]')) {
      toml += '\n[features]\nhooks = true\n';
    } else {
      toml = toml.replace('[features]', '[features]\nhooks = true');
    }
  }

  // Write trust hashes to [hooks.state] — remove old entries first
  // Strip existing hooks.state sections that reference our notify.mjs (handles both
  // agent-notify directory name and ai-agent-notifier package name)
  toml = toml.replace(/\[hooks\.state\.'[^']*(?:agent-notify|ai-agent-notifier)[^']*'\]\s*trusted_hash\s*=\s*"[^"]*"\s*/g, '');
  // Ensure [hooks.state] section exists
  if (!toml.includes('[hooks.state]')) {
    toml += '\n[hooks.state]\n';
  }
  // Append trust entries
  for (const { key, hash } of trustEntries) {
    toml += `\n[hooks.state.'${key}']\ntrusted_hash = "${hash}"\n`;
  }

  fs.writeFileSync(tomlPath, toml, 'utf8');
}

export function patchCursor(cursorDir, notifyPath, backupDir) {
  const hooksPath = path.join(cursorDir, 'hooks.json');
  backup(hooksPath, backupDir);
  const existing = readJSON(hooksPath) || {};
  if (!existing.hooks) existing.hooks = {};
  existing.version = 1; // Required by Cursor schema

  // Cursor uses FLAT format: { command: "..." } — NOT nested like Claude/Codex.
  // camelCase event names. "stop" fires when agent loop ends.
  // Also supports: sessionEnd, preToolUse, postToolUse, subagentStop, etc.
  // Cursor sends { status, loop_count } on stdin — no hook_event_name, so pass --event.
  // Forward slashes avoid shell escape issues on Windows.
  const safePath = notifyPath.replace(/\\/g, '/');
  const hook = { command: `node "${safePath}" --source cursor --event stop` };

  existing.hooks.stop = [...removeManagedHooks(existing.hooks.stop), hook];

  // Clean up stale "notification" event from previous versions (doesn't exist in Cursor)
  if (existing.hooks.notification) {
    existing.hooks.notification = removeManagedHooks(existing.hooks.notification);
    if (existing.hooks.notification.length === 0) delete existing.hooks.notification;
  }

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
    { dir: '.codex', file: 'hooks.json', events: ['Stop', 'SessionStart', 'PermissionRequest'] },
    { dir: '.cursor', file: 'hooks.json', events: ['stop'] },
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
