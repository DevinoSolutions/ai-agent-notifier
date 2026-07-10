// setup/patch-config.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const MANAGED_TAG = 'ai-agent-notifier';

// Single source of truth for which hook events each tool's patcher writes.
// unpatchAll cleans EXACTLY these events, so patch and unpatch can never diverge
// (e.g. cleaning an event patch never wrote). Change an event list in one place.
export const TOOL_EVENTS = {
  claude: { dir: '.claude', file: 'settings.json', label: 'Claude Code', events: ['Notification', 'Stop'] },
  codex: { dir: '.codex', file: 'hooks.json', label: 'Codex CLI', events: ['Stop', 'SessionStart', 'PermissionRequest'] },
  cursor: { dir: '.cursor', file: 'hooks.json', label: 'Cursor IDE', events: ['stop'] },
  gemini: { dir: '.gemini', file: 'settings.json', label: 'Gemini CLI', events: ['AfterAgent', 'Notification'] },
};

// Read JSON, returning null ONLY when the file is absent (or empty — an empty
// file has no user content to lose). A file that EXISTS with non-empty, invalid
// JSON THROWS: treating a corrupt real config as "empty" would silently overwrite
// the user's settings. Callers surface the throw as a per-tool setup failure.
function readJSONOrNull(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  if (raw.trim() === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${filePath} is not valid JSON — fix or remove it before patching`);
  }
}

// Atomic write: temp file + rename, so a crash mid-write can never leave the
// user's real tool config truncated. Mirrors src/config-loader.mjs saveConfig.
function writeFileAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function writeJSON(filePath, data) {
  writeFileAtomic(filePath, JSON.stringify(data, null, 2) + '\n');
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

// The ONE predicate that decides whether a hook-array entry is ours. Covers all
// three on-disk shapes: the _managed_by tag (Claude), the nested { hooks: [...] }
// command form (Claude/Codex/Gemini), and the FLAT { command } form (Cursor).
// Everything else — removeManagedHooks, ourHookIndices, and status detection —
// is built on this so detection can never drift between write and read paths.
export function isManagedHookEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return Boolean(
    entry._managed_by === MANAGED_TAG ||
    (Array.isArray(entry.hooks) && entry.hooks.some((hh) => isOurHook(hh.command))) ||
    isOurHook(entry.command)
  );
}

// Event names in a tool's hooks object that contain at least one managed entry.
// This is the single detection used by `ai-agent-notifier status`.
export function detectManagedEvents(hooksObject) {
  if (!hooksObject || typeof hooksObject !== 'object') return [];
  return Object.keys(hooksObject).filter((event) =>
    Array.isArray(hooksObject[event]) && hooksObject[event].some(isManagedHookEntry)
  );
}

function removeManagedHooks(hooksArray) {
  if (!Array.isArray(hooksArray)) return [];
  return hooksArray.filter((h) => !isManagedHookEntry(h));
}

export function patchClaude(claudeDir, notifyPath, backupDir) {
  const settingsPath = path.join(claudeDir, 'settings.json');
  backup(settingsPath, backupDir);
  const settings = readJSONOrNull(settingsPath) || {};
  if (!settings.hooks) settings.hooks = {};

  const hook = makeHookEntry(notifyPath, 'claude', { timeout: 10 });
  hook.matcher = '';

  for (const event of TOOL_EVENTS.claude.events) {
    settings.hooks[event] = [...removeManagedHooks(settings.hooks[event]), hook];
  }

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
export function canonicalJson(val) {
  if (val === null || val === undefined) return JSON.stringify(null);
  if (typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) return '[' + val.map(canonicalJson).join(',') + ']';
  const sorted = Object.keys(val).sort();
  return '{' + sorted.map(k => JSON.stringify(k) + ':' + canonicalJson(val[k])).join(',') + '}';
}

export function codexHookHash(eventName, command, { timeout, matcher, isAsync = false, statusMessage } = {}) {
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

// Rewrite the [hooks.state] namespace deterministically so the config stays valid
// no matter what was there before: a prior install of ours, codex's own runtime
// state, or an already-corrupted file with duplicate keys.
//
// Codex keys each trust entry by "<hooks.json path>:<event>:<group>:<handler>"
// (e.g. "C:\\Users\\me\\.codex\\hooks.json:stop:0:0"), NOT by the notifier path —
// so previously-written entries can't be matched by package name. Instead we:
//   1. lift every [hooks.state] / [hooks.state.'k'] block out of the file,
//   2. keep at most one entry per key (collapsing any duplicates),
//   3. drop the keys we are about to (re)write, and
//   4. re-emit a single clean [hooks.state] section with our fresh entries.
// Everything outside the hooks.state namespace is preserved verbatim and in place.
function rebuildHooksState(toml, trustEntries) {
  const eol = toml.includes('\r\n') ? '\r\n' : '\n';
  const lines = toml.split(/\r?\n/);
  const isHeader = (l) => { const t = l.trim(); return t.startsWith('[') && t.endsWith(']'); };
  const ourKeys = new Set(trustEntries.map((e) => e.key));

  const kept = [];             // every line that is NOT part of hooks.state
  const preserved = new Map(); // foreign state key -> body lines (first occurrence wins)

  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (isHeader(line)) {
      const inside = line.trim().slice(1, -1);
      const sub = inside.match(/^hooks\.state\.(?:'(.*)'|"(.*)")$/);
      if (inside === 'hooks.state' || sub) {
        // Consume this block's body (lines up to the next table header).
        let j = i + 1;
        const body = [];
        while (j < lines.length && !isHeader(lines[j])) { body.push(lines[j]); j++; }
        if (sub) {
          const key = sub[1] ?? sub[2];
          if (!ourKeys.has(key) && !preserved.has(key)) preserved.set(key, body);
        }
        i = j;
        continue;
      }
    }
    kept.push(line);
    i++;
  }

  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();

  const region = ['[hooks.state]'];
  for (const [key, body] of preserved) {
    region.push('', `[hooks.state.'${key}']`);
    for (const b of body) if (b.trim() !== '') region.push(b);
  }
  for (const { key, hash } of trustEntries) {
    region.push('', `[hooks.state.'${key}']`, `trusted_hash = "${hash}"`);
  }

  return kept.join(eol) + eol + eol + region.join(eol) + eol;
}

export function patchCodex(codexDir, notifyPath, backupDir) {
  // TODO(audit CL-18): config.toml is patched via string surgery below; a
  // malformed-but-parseable file can be mangled. Needs a minimal TOML
  // round-tripper or upstream JSON config support. Do not extend this string
  // logic further.
  const hooksPath = path.join(codexDir, 'hooks.json');
  backup(hooksPath, backupDir);
  const existing = readJSONOrNull(hooksPath) || { hooks: {} };
  if (!existing.hooks) existing.hooks = {};

  // Codex (Rust) may use sh/bash to execute hook commands on Windows.
  // Forward slashes avoid shell escape issues and work on all platforms.
  const safePath = notifyPath.replace(/\\/g, '/');

  // Codex uses strict schema — no _managed_by, must include statusMessage.
  // Timeout is in seconds. Hooks only fire in interactive TUI (not exec mode).
  // These events differ only by the --event arg, so derive them from TOOL_EVENTS.
  const hookByEvent = {};
  for (const event of TOOL_EVENTS.codex.events) {
    const hook = makeHookEntry(safePath, 'codex', {
      tag: false, timeout: 10, statusMessage: 'Sending notification', event,
    });
    existing.hooks[event] = [...removeManagedHooks(existing.hooks[event]), hook];
    hookByEvent[event] = hook;
  }

  writeJSON(hooksPath, existing);

  // Compute trust hashes so Codex CLI auto-trusts hooks without prompting.
  // Codex stores trusted_hash in config.toml under [hooks.state.<key>], where the
  // key encodes the snake_case event and the hook's array index. Derive both the
  // key and the hash from TOOL_EVENTS so they always match what we just wrote.
  // Without matching hashes, unmanaged hooks are silently skipped.
  const hashOpts = { timeout: 10, statusMessage: 'Sending notification' };
  const trustEntries = TOOL_EVENTS.codex.events.map((event) => {
    const segment = eventKeySegment(event);
    const cmd = hookByEvent[event].hooks[0].command;
    const idx = existing.hooks[event].length - 1;
    return { key: `${hooksPath}:${segment}:${idx}:0`, hash: codexHookHash(segment, cmd, hashOpts) };
  });

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

  // Rewrite [hooks.state] from scratch. Re-running setup, or running it after
  // codex has written its own trust state, must never leave duplicate TOML keys
  // (which make codex fail to load config.toml with a "duplicate key" error).
  toml = rebuildHooksState(toml, trustEntries);

  writeFileAtomic(tomlPath, toml);
}

export function patchCursor(cursorDir, notifyPath, backupDir) {
  const hooksPath = path.join(cursorDir, 'hooks.json');
  backup(hooksPath, backupDir);
  const existing = readJSONOrNull(hooksPath) || {};
  if (!existing.hooks) existing.hooks = {};
  existing.version = 1; // Required by Cursor schema

  // Cursor uses FLAT format: { command: "..." } — NOT nested like Claude/Codex.
  // camelCase event names. "stop" fires when agent loop ends.
  // Also supports: sessionEnd, preToolUse, postToolUse, subagentStop, etc.
  // Cursor sends { status, loop_count } on stdin — no hook_event_name, so pass --event.
  // Forward slashes avoid shell escape issues on Windows.
  const safePath = notifyPath.replace(/\\/g, '/');
  const hook = { command: `node "${safePath}" --source cursor --event stop` };

  for (const event of TOOL_EVENTS.cursor.events) {
    existing.hooks[event] = [...removeManagedHooks(existing.hooks[event]), hook];
  }

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
  const settings = readJSONOrNull(settingsPath) || {};
  if (!settings.hooks) settings.hooks = {};

  // Gemini timeout is in milliseconds (default 60000)
  const hook = makeHookEntry(notifyPath, 'gemini', { timeout: 30000 });

  for (const event of TOOL_EVENTS.gemini.events) {
    settings.hooks[event] = [...removeManagedHooks(settings.hooks[event]), hook];
  }

  writeJSON(settingsPath, settings);

  // Clean up stale hooks.json if we created one previously. Best-effort: a
  // corrupt stale file must not block patching the real settings.json.
  const staleHooksPath = path.join(geminiDir, 'hooks.json');
  let staleData = null;
  try { staleData = readJSONOrNull(staleHooksPath); } catch { staleData = null; }
  if (staleData?.hooks) {
    let changed = false;
    for (const event of TOOL_EVENTS.gemini.events) {
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

// Indices of our managed hooks within an event's hook array (same predicate as
// removeManagedHooks). Used to reconstruct the codex trust-state keys, which
// encode each hook's position.
function ourHookIndices(hooksArray) {
  if (!Array.isArray(hooksArray)) return [];
  const idxs = [];
  hooksArray.forEach((h, i) => { if (isManagedHookEntry(h)) idxs.push(i); });
  return idxs;
}

// Codex derives the trust-state key segment from the event name in snake_case:
// Stop -> stop, SessionStart -> session_start, PermissionRequest -> permission_request.
function eventKeySegment(event) {
  return event.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

// Inverse of rebuildHooksState: drop the [hooks.state.'<key>'] blocks whose key
// is in keysToRemove, preserving every other line (and foreign state entries) in
// place. When no state entries remain, the [hooks.state] section is removed.
function stripHooksStateKeys(toml, keysToRemove) {
  const eol = toml.includes('\r\n') ? '\r\n' : '\n';
  const lines = toml.split(/\r?\n/);
  const isHeader = (l) => { const t = l.trim(); return t.startsWith('[') && t.endsWith(']'); };
  const drop = new Set(keysToRemove);

  const kept = [];
  const preserved = new Map();

  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (isHeader(line)) {
      const inside = line.trim().slice(1, -1);
      const sub = inside.match(/^hooks\.state\.(?:'(.*)'|"(.*)")$/);
      if (inside === 'hooks.state' || sub) {
        let j = i + 1;
        const body = [];
        while (j < lines.length && !isHeader(lines[j])) { body.push(lines[j]); j++; }
        if (sub) {
          const key = sub[1] ?? sub[2];
          if (!drop.has(key) && !preserved.has(key)) preserved.set(key, body);
        }
        i = j;
        continue;
      }
    }
    kept.push(line);
    i++;
  }

  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();

  if (preserved.size === 0) {
    return kept.length ? kept.join(eol) + eol : '';
  }

  const region = ['[hooks.state]'];
  for (const [key, body] of preserved) {
    region.push('', `[hooks.state.'${key}']`);
    for (const b of body) if (b.trim() !== '') region.push(b);
  }
  return kept.join(eol) + eol + eol + region.join(eol) + eol;
}

// Remove our hooks from every tool. Returns one { tool, ok, reason } per tool so
// the caller (uninstall) can report each and fail loud on any error, instead of
// swallowing per-tool failures and always claiming success. Never throws.
export function unpatchAll(homeDir, backupDir) {
  const results = [];

  for (const tool of Object.values(TOOL_EVENTS)) {
    const filePath = path.join(homeDir, tool.dir, tool.file);
    try {
      let data;
      try {
        data = readJSONOrNull(filePath);
      } catch (err) {
        // Corrupt config: report loudly rather than silently skipping.
        results.push({ tool: tool.label, ok: false, reason: err.message });
        continue;
      }

      if (!data?.hooks) {
        results.push({ tool: tool.label, ok: true, reason: 'nothing to remove' });
        continue;
      }
      backup(filePath, backupDir);

      // Capture our codex trust-state keys BEFORE removal — they encode each hook's
      // array index, which changes once the hook is gone.
      const codexKeysToRemove = [];
      if (tool.dir === '.codex') {
        for (const event of tool.events) {
          for (const idx of ourHookIndices(data.hooks[event])) {
            codexKeysToRemove.push(`${filePath}:${eventKeySegment(event)}:${idx}:0`);
          }
        }
      }

      let removedAny = false;
      for (const event of tool.events) {
        if (data.hooks[event]) {
          const before = data.hooks[event].length;
          data.hooks[event] = removeManagedHooks(data.hooks[event]);
          if (data.hooks[event].length !== before) removedAny = true;
          if (data.hooks[event].length === 0) delete data.hooks[event];
        }
      }
      writeJSON(filePath, data);

      // Codex keeps hook trust hashes in config.toml [hooks.state]. Remove ours so
      // no orphaned trust entries linger after uninstall. The [features] hooks flag
      // is left intact in case the user has other hooks.
      if (tool.dir === '.codex' && codexKeysToRemove.length) {
        const tomlPath = path.join(homeDir, tool.dir, 'config.toml');
        let toml = '';
        try { toml = fs.readFileSync(tomlPath, 'utf8'); } catch { toml = ''; }
        if (toml) {
          backup(tomlPath, backupDir);
          writeFileAtomic(tomlPath, stripHooksStateKeys(toml, codexKeysToRemove));
        }
      }

      results.push({ tool: tool.label, ok: true, reason: removedAny ? 'hooks removed' : 'nothing to remove' });
    } catch (err) {
      results.push({ tool: tool.label, ok: false, reason: err.message });
    }
  }

  return results;
}
