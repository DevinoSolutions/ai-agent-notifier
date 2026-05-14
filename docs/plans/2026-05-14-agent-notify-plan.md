# ai-agent-notifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-platform npm package that provides native toast + ntfy notifications for Claude Code, Codex CLI, Gemini CLI, and Cursor IDE via their hook systems.

**Architecture:** Node.js entry point (`notify.mjs`) reads JSON from stdin, normalizes across tools, dispatches to platform-native toast backend + ntfy webhook in parallel. CLI (`ai-agent-notifier`) handles setup, config, status, and testing. Zero production dependencies.

**Tech Stack:** Node.js 18+ (ESM), PowerShell 7 + BurntToast (Windows), osascript (macOS), notify-send (Linux), ntfy.sh (push)

---

## File Map

| File | Responsibility |
|---|---|
| `package.json` | npm package manifest, bin entry |
| `.gitignore` | Ignore node_modules, backups, icon.png |
| `LICENSE` | MIT license |
| `config/default-config.json` | Default notification preferences |
| `src/config-loader.mjs` | Load/merge user config with defaults |
| `src/parse-input.mjs` | Normalize stdin JSON from all 4 tools |
| `src/router.mjs` | Map normalized events to notification params |
| `src/ntfy.mjs` | Send ntfy/webhook push notifications |
| `src/platforms/windows.mjs` | Windows BurntToast toast dispatch |
| `src/platforms/macos.mjs` | macOS osascript toast dispatch |
| `src/platforms/linux.mjs` | Linux notify-send dispatch |
| `src/notify.mjs` | Entry point: stdin -> parse -> route -> dispatch |
| `assets/windows/toast.ps1` | BurntToast toast with click-to-focus |
| `assets/windows/focus.vbs` | Zero-window launcher for focus-window.ps1 |
| `assets/windows/focus-window.ps1` | Win32 EnumWindows focus logic |
| `cli/index.mjs` | CLI entry point, command routing |
| `cli/setup.mjs` | Interactive setup wizard |
| `cli/status.mjs` | Show wired tools and config |
| `cli/test-cmd.mjs` | Fire test notifications |
| `cli/config-cmd.mjs` | Interactive settings menu |
| `cli/uninstall.mjs` | Clean removal from all tools |
| `setup/patch-config.mjs` | Safely merge hooks into each tool's config |
| `setup/install.ps1` | Windows standalone installer (fallback) |
| `setup/install.sh` | macOS/Linux standalone installer (fallback) |
| `.claude-plugin/plugin.json` | Claude Code plugin manifest |
| `.claude-plugin/marketplace.json` | Marketplace metadata |
| `hooks/hooks.json` | Claude Code plugin hook definitions |
| `commands/setup.md` | /ai-agent-notifier:setup slash command |
| `commands/test.md` | /ai-agent-notifier:test slash command |
| `tests/parse-input.test.mjs` | Unit tests for input normalization |
| `tests/router.test.mjs` | Unit tests for event routing |
| `tests/config-loader.test.mjs` | Unit tests for config loading |
| `tests/patch-config.test.mjs` | Unit tests for config patching |
| `tests/ntfy.test.mjs` | Unit tests for ntfy URL/header construction |

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `config/default-config.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "ai-agent-notifier",
  "version": "1.0.0",
  "description": "Cross-platform notifications for AI coding agents (Claude Code, Codex, Gemini CLI, Cursor)",
  "type": "module",
  "bin": {
    "ai-agent-notifier": "./cli/index.mjs"
  },
  "main": "./src/notify.mjs",
  "scripts": {
    "test": "node --test tests/"
  },
  "keywords": [
    "notifications",
    "claude",
    "codex",
    "gemini",
    "cursor",
    "ai-agent",
    "toast",
    "ntfy",
    "hooks"
  ],
  "author": {
    "name": "DevinoSolutions",
    "url": "https://github.com/DevinoSolutions"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/DevinoSolutions/ai-agent-notifier"
  },
  "license": "MIT",
  "engines": {
    "node": ">=18.0.0"
  },
  "files": [
    "src/",
    "cli/",
    "setup/",
    "assets/",
    "config/",
    "hooks/",
    "commands/",
    ".claude-plugin/"
  ]
}
```

- [ ] **Step 2: Create .gitignore**

```
node_modules/
assets/icon.png
*.backup
.ai-agent-notifier-backup
```

- [ ] **Step 3: Create LICENSE**

Standard MIT license with `Copyright (c) 2026 DevinoSolutions`.

- [ ] **Step 4: Create default-config.json**

```json
{
  "ntfy": {
    "enabled": true,
    "server": "https://ntfy.sh",
    "topic": "",
    "icon": "https://claude.ai/images/claude_app_icon.png",
    "click": "https://claude.ai/"
  },
  "toast": {
    "enabled": true,
    "clickToFocus": true
  },
  "events": {
    "task_complete": {
      "sound": "IM",
      "ntfyPriority": "default",
      "ntfyTags": "white_check_mark"
    },
    "needs_input": {
      "sound": "Reminder",
      "ntfyPriority": "urgent",
      "ntfyTags": "bell,warning"
    },
    "session_start": {
      "sound": "Default",
      "ntfyPriority": "low",
      "ntfyTags": "rocket",
      "toastEnabled": false,
      "ntfyEnabled": false
    }
  },
  "sources": {
    "claude": { "label": "Claude Code" },
    "codex": { "label": "Codex" },
    "gemini": { "label": "Gemini" },
    "cursor": { "label": "Cursor" }
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore LICENSE config/default-config.json
git commit -m "feat: project scaffolding with package.json, defaults, license"
```

---

### Task 2: Config Loader

**Files:**
- Create: `tests/config-loader.test.mjs`
- Create: `src/config-loader.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/config-loader.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// We'll test with a temp dir as home
const tmpDir = path.join(os.tmpdir(), 'ai-agent-notifier-test-' + Date.now());
const configDir = path.join(tmpDir, '.ai-agent-notifier');
const configPath = path.join(configDir, 'config.json');

describe('config-loader', () => {
  beforeEach(() => {
    fs.mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when no user config exists', async () => {
    const { loadConfig } = await import('../src/config-loader.mjs');
    const config = loadConfig(path.join(tmpDir, 'nonexistent', 'config.json'));
    assert.equal(config.ntfy.server, 'https://ntfy.sh');
    assert.equal(config.toast.enabled, true);
    assert.equal(config.events.task_complete.sound, 'IM');
  });

  it('merges user config over defaults', async () => {
    const userConfig = {
      ntfy: { topic: 'my-topic', enabled: false }
    };
    fs.writeFileSync(configPath, JSON.stringify(userConfig));
    const { loadConfig } = await import('../src/config-loader.mjs');
    const config = loadConfig(configPath);
    assert.equal(config.ntfy.topic, 'my-topic');
    assert.equal(config.ntfy.enabled, false);
    // defaults preserved for unset keys
    assert.equal(config.ntfy.server, 'https://ntfy.sh');
    assert.equal(config.toast.enabled, true);
  });

  it('saves config to disk', async () => {
    const { loadConfig, saveConfig } = await import('../src/config-loader.mjs');
    const config = loadConfig(configPath);
    config.ntfy.topic = 'saved-topic';
    saveConfig(configPath, config);
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(raw.ntfy.topic, 'saved-topic');
  });

  it('getConfigDir returns ~/.ai-agent-notifier', async () => {
    const { getConfigDir } = await import('../src/config-loader.mjs');
    const dir = getConfigDir();
    assert.ok(dir.endsWith('.ai-agent-notifier'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:\Users\amind\OneDrive\Desktop\Projects\CUSTOM MCPs\ai-agent-notifier" && node --test tests/config-loader.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```javascript
// src/config-loader.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const defaults = require('../config/default-config.json', { with: { type: 'json' } });

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
```

Note: `createRequire` is used because JSON imports with `with { type: 'json' }` may not be stable on all Node 18 builds. If the runtime supports import attributes, switch to `import defaults from '../config/default-config.json' with { type: 'json' }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/config-loader.test.mjs`
Expected: 4 passing

- [ ] **Step 5: Commit**

```bash
git add src/config-loader.mjs tests/config-loader.test.mjs
git commit -m "feat: config loader with deep merge and defaults"
```

---

### Task 3: Input Parser

**Files:**
- Create: `tests/parse-input.test.mjs`
- Create: `src/parse-input.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/parse-input.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseInput } from '../src/parse-input.mjs';

describe('parseInput', () => {
  it('normalizes Claude Code Stop event', () => {
    const raw = { session_id: 's1', cwd: '/home/user/my-project', hook_event_name: 'Stop' };
    const result = parseInput(raw, 'claude');
    assert.equal(result.source, 'claude');
    assert.equal(result.event, 'task_complete');
    assert.equal(result.cwd, '/home/user/my-project');
    assert.equal(result.projectName, 'my-project');
    assert.equal(result.sessionId, 's1');
    assert.equal(result.rawEvent, 'Stop');
  });

  it('normalizes Claude Code Notification event', () => {
    const raw = { session_id: 's2', cwd: '/projects/app', hook_event_name: 'Notification' };
    const result = parseInput(raw, 'claude');
    assert.equal(result.event, 'needs_input');
  });

  it('normalizes Codex Stop event', () => {
    const raw = { session_id: 'c1', cwd: '/work/repo', hook_event_name: 'Stop' };
    const result = parseInput(raw, 'codex');
    assert.equal(result.source, 'codex');
    assert.equal(result.event, 'task_complete');
  });

  it('normalizes Codex PermissionRequest event', () => {
    const raw = { session_id: 'c2', cwd: '/work/repo', hook_event_name: 'PermissionRequest' };
    const result = parseInput(raw, 'codex');
    assert.equal(result.event, 'needs_input');
  });

  it('normalizes Gemini AfterAgent event', () => {
    const raw = { session_id: 'g1', cwd: '/dev/project', hook_event_name: 'AfterAgent' };
    const result = parseInput(raw, 'gemini');
    assert.equal(result.event, 'task_complete');
  });

  it('normalizes Gemini Notification event', () => {
    const raw = { session_id: 'g2', cwd: '/dev/project', hook_event_name: 'Notification' };
    const result = parseInput(raw, 'gemini');
    assert.equal(result.event, 'needs_input');
  });

  it('normalizes Cursor stop event', () => {
    const raw = { session_id: 'cu1', cwd: '/code/app', hook_event_name: 'stop' };
    const result = parseInput(raw, 'cursor');
    assert.equal(result.event, 'task_complete');
  });

  it('normalizes Cursor notification event', () => {
    const raw = { session_id: 'cu2', cwd: '/code/app', hook_event_name: 'notification' };
    const result = parseInput(raw, 'cursor');
    assert.equal(result.event, 'needs_input');
  });

  it('normalizes SessionStart across tools', () => {
    const raw = { session_id: 'x', cwd: '/p', hook_event_name: 'SessionStart' };
    assert.equal(parseInput(raw, 'claude').event, 'session_start');
    assert.equal(parseInput(raw, 'codex').event, 'session_start');
  });

  it('extracts projectName from cwd', () => {
    const raw = { session_id: 'x', cwd: 'C:\\Users\\dev\\my-app', hook_event_name: 'Stop' };
    const result = parseInput(raw, 'claude');
    assert.equal(result.projectName, 'my-app');
  });

  it('handles missing cwd gracefully', () => {
    const raw = { session_id: 'x', hook_event_name: 'Stop' };
    const result = parseInput(raw, 'claude');
    assert.equal(result.cwd, '');
    assert.equal(result.projectName, '');
  });

  it('returns unknown event for unmapped hook names', () => {
    const raw = { session_id: 'x', cwd: '/p', hook_event_name: 'PreToolUse' };
    const result = parseInput(raw, 'claude');
    assert.equal(result.event, 'unknown');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/parse-input.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```javascript
// src/parse-input.mjs
import path from 'node:path';

const EVENT_MAP = {
  claude: {
    Stop: 'task_complete',
    Notification: 'needs_input',
    SessionStart: 'session_start',
  },
  codex: {
    Stop: 'task_complete',
    PermissionRequest: 'needs_input',
    SessionStart: 'session_start',
  },
  gemini: {
    AfterAgent: 'task_complete',
    Notification: 'needs_input',
    SessionStart: 'session_start',
  },
  cursor: {
    stop: 'task_complete',
    notification: 'needs_input',
  },
};

export function parseInput(raw, source) {
  const hookEvent = raw.hook_event_name || raw.hookEventName || '';
  const cwd = raw.cwd || '';
  const map = EVENT_MAP[source] || {};

  return {
    source,
    event: map[hookEvent] || 'unknown',
    cwd,
    projectName: cwd ? path.basename(cwd) : '',
    sessionId: raw.session_id || raw.sessionId || '',
    rawEvent: hookEvent,
    raw,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/parse-input.test.mjs`
Expected: 12 passing

- [ ] **Step 5: Commit**

```bash
git add src/parse-input.mjs tests/parse-input.test.mjs
git commit -m "feat: input parser normalizing stdin from Claude/Codex/Gemini/Cursor"
```

---

### Task 4: Router

**Files:**
- Create: `tests/router.test.mjs`
- Create: `src/router.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/router.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../src/router.mjs';

const defaultConfig = {
  events: {
    task_complete: { sound: 'IM', ntfyPriority: 'default', ntfyTags: 'white_check_mark' },
    needs_input: { sound: 'Reminder', ntfyPriority: 'urgent', ntfyTags: 'bell,warning' },
  },
  sources: {
    claude: { label: 'Claude Code' },
    codex: { label: 'Codex' },
  },
};

describe('route', () => {
  it('routes task_complete from claude', () => {
    const event = { source: 'claude', event: 'task_complete', projectName: 'my-app' };
    const notif = route(event, defaultConfig);
    assert.equal(notif.title, 'Claude Code');
    assert.equal(notif.message, 'my-app: Task complete');
    assert.equal(notif.sound, 'IM');
    assert.equal(notif.ntfyPriority, 'default');
    assert.equal(notif.ntfyTags, 'white_check_mark');
  });

  it('routes needs_input from codex', () => {
    const event = { source: 'codex', event: 'needs_input', projectName: 'backend' };
    const notif = route(event, defaultConfig);
    assert.equal(notif.title, 'Codex');
    assert.equal(notif.message, 'backend: Needs your input');
    assert.equal(notif.sound, 'Reminder');
    assert.equal(notif.ntfyPriority, 'urgent');
  });

  it('uses source name as title fallback for unknown sources', () => {
    const event = { source: 'future-tool', event: 'task_complete', projectName: 'app' };
    const notif = route(event, defaultConfig);
    assert.equal(notif.title, 'future-tool');
  });

  it('handles missing projectName', () => {
    const event = { source: 'claude', event: 'task_complete', projectName: '' };
    const notif = route(event, defaultConfig);
    assert.equal(notif.message, 'Task complete');
  });

  it('returns null for unknown events', () => {
    const event = { source: 'claude', event: 'unknown', projectName: 'app' };
    const notif = route(event, defaultConfig);
    assert.equal(notif, null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/router.test.mjs`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```javascript
// src/router.mjs

const EVENT_MESSAGES = {
  task_complete: 'Task complete',
  needs_input: 'Needs your input',
  session_start: 'Session started',
};

export function route(event, config) {
  const messageTemplate = EVENT_MESSAGES[event.event];
  if (!messageTemplate) return null;

  const eventConfig = config.events?.[event.event] || {};
  const sourceConfig = config.sources?.[event.source] || {};
  const label = sourceConfig.label || event.source;
  const prefix = event.projectName ? `${event.projectName}: ` : '';

  return {
    title: label,
    message: `${prefix}${messageTemplate}`,
    sound: eventConfig.sound || 'Default',
    ntfyPriority: eventConfig.ntfyPriority || 'default',
    ntfyTags: eventConfig.ntfyTags || '',
    event: event.event,
    source: event.source,
    projectName: event.projectName,
    cwd: event.cwd,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/router.test.mjs`
Expected: 5 passing

- [ ] **Step 5: Commit**

```bash
git add src/router.mjs tests/router.test.mjs
git commit -m "feat: router mapping normalized events to notification params"
```

---

### Task 5: ntfy Sender

**Files:**
- Create: `tests/ntfy.test.mjs`
- Create: `src/ntfy.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/ntfy.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildNtfyRequest } from '../src/ntfy.mjs';

describe('buildNtfyRequest', () => {
  const ntfyConfig = {
    server: 'https://ntfy.sh',
    topic: 'test-topic-123',
    icon: 'https://example.com/icon.png',
    click: 'https://example.com',
  };

  it('builds correct URL', () => {
    const req = buildNtfyRequest(ntfyConfig, {
      title: 'Claude Code',
      message: 'Task complete',
      ntfyPriority: 'default',
      ntfyTags: 'check',
    });
    assert.equal(req.url, 'https://ntfy.sh/test-topic-123');
  });

  it('sets correct headers', () => {
    const req = buildNtfyRequest(ntfyConfig, {
      title: 'Codex',
      message: 'Needs input',
      ntfyPriority: 'urgent',
      ntfyTags: 'bell,warning',
    });
    assert.equal(req.headers.Title, 'Codex');
    assert.equal(req.headers.Priority, 'urgent');
    assert.equal(req.headers.Tags, 'bell,warning');
    assert.equal(req.headers.Icon, 'https://example.com/icon.png');
    assert.equal(req.headers.Click, 'https://example.com');
  });

  it('uses message as body', () => {
    const req = buildNtfyRequest(ntfyConfig, {
      title: 'Test',
      message: 'Hello world',
      ntfyPriority: 'default',
      ntfyTags: '',
    });
    assert.equal(req.body, 'Hello world');
  });

  it('omits empty tags header', () => {
    const req = buildNtfyRequest(ntfyConfig, {
      title: 'Test',
      message: 'msg',
      ntfyPriority: 'default',
      ntfyTags: '',
    });
    assert.equal(req.headers.Tags, undefined);
  });

  it('strips trailing slash from server', () => {
    const req = buildNtfyRequest(
      { ...ntfyConfig, server: 'https://ntfy.sh/' },
      { title: 'T', message: 'm', ntfyPriority: 'default', ntfyTags: '' }
    );
    assert.equal(req.url, 'https://ntfy.sh/test-topic-123');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/ntfy.test.mjs`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```javascript
// src/ntfy.mjs
import https from 'node:https';
import http from 'node:http';

export function buildNtfyRequest(ntfyConfig, notification) {
  const server = (ntfyConfig.server || 'https://ntfy.sh').replace(/\/+$/, '');
  const url = `${server}/${ntfyConfig.topic}`;

  const headers = {
    Title: notification.title,
    Priority: notification.ntfyPriority || 'default',
  };

  if (notification.ntfyTags) headers.Tags = notification.ntfyTags;
  if (ntfyConfig.icon) headers.Icon = ntfyConfig.icon;
  if (ntfyConfig.click) headers.Click = ntfyConfig.click;

  return { url, headers, body: notification.message };
}

export function sendNtfy(ntfyConfig, notification) {
  return new Promise((resolve) => {
    if (!ntfyConfig.topic) { resolve(false); return; }

    const { url, headers, body } = buildNtfyRequest(ntfyConfig, notification);
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const req = transport.request(parsed, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
      timeout: 5000,
    }, (res) => {
      res.resume(); // drain
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end(body);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/ntfy.test.mjs`
Expected: 5 passing

- [ ] **Step 5: Commit**

```bash
git add src/ntfy.mjs tests/ntfy.test.mjs
git commit -m "feat: ntfy sender with request builder and async dispatch"
```

---

### Task 6: Windows Toast Backend + Assets

**Files:**
- Create: `src/platforms/windows.mjs`
- Create: `assets/windows/toast.ps1`
- Create: `assets/windows/focus.vbs`
- Create: `assets/windows/focus-window.ps1`

- [ ] **Step 1: Create toast.ps1**

This is the BurntToast toast script extracted from the existing setup. Key change: `agentfocus://` protocol instead of `claudefocus://`, and accepts `--source` parameter for the title icon.

```powershell
param(
  [string]$Title = 'Agent Notify',
  [string]$Message = 'Needs your attention',
  [string]$Sound = 'Default',
  [string]$ProjectName = '',
  [string]$Cwd = ''
)
$logo = Join-Path $PSScriptRoot '..\..\assets\icon.png'
# Fallback if icon.png not at expected location
if (-not (Test-Path $logo)) {
  $agentDir = Join-Path $env:USERPROFILE '.ai-agent-notifier'
  $logo = Join-Path $agentDir 'icon.png'
}
$launchUri = $null

function Register-AgentFocusProtocol {
  $regPath = 'HKCU:\Software\Classes\agentfocus'
  $handler = Join-Path $PSScriptRoot 'focus.vbs'
  $cmd = "wscript.exe `"$handler`" `"%1`""
  $existing = (Get-ItemProperty "$regPath\shell\open\command" -ErrorAction SilentlyContinue).'(default)'
  if ($existing -eq $cmd) { return }
  New-Item -Path $regPath -Force | Out-Null
  Set-ItemProperty -Path $regPath -Name '(default)' -Value 'URL:Agent Focus Protocol'
  Set-ItemProperty -Path $regPath -Name 'URL Protocol' -Value ''
  New-Item -Path "$regPath\shell\open\command" -Force | Out-Null
  Set-ItemProperty -Path "$regPath\shell\open\command" -Name '(default)' -Value $cmd
}
Register-AgentFocusProtocol

function Get-AncestorWindowHandle {
  $id = $PID
  for ($i = 0; $i -lt 10; $i++) {
    try {
      $p = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
      if (-not $p) { break }
      $id = [int]$p.ParentProcessId
      if ($id -le 0) { break }
      $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
      if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
        return [int64]$proc.MainWindowHandle
      }
    } catch { break }
  }
  return 0
}

if ($ProjectName) {
  $hwnd = Get-AncestorWindowHandle
  $launchUri = "agentfocus://$([uri]::EscapeDataString($ProjectName))/?hwnd=$hwnd"
}

try {
  Import-Module BurntToast -ErrorAction Stop

  if ($launchUri) {
    $audio   = New-BTAudio -Source "ms-winsoundevent:Notification.$Sound"
    $text1   = New-BTText -Text $Title
    $text2   = New-BTText -Text $Message
    $binding = if (Test-Path $logo) {
      $appLogo = New-BTImage -Source $logo -AppLogoOverride -Crop Circle
      New-BTBinding -Children $text1, $text2 -AppLogoOverride $appLogo
    } else {
      New-BTBinding -Children $text1, $text2
    }
    $visual  = New-BTVisual -BindingGeneric $binding
    $content = New-BTContent -Audio $audio -Visual $visual -Launch $launchUri -ActivationType Protocol
    Submit-BTNotification -Content $content
  } else {
    if (Test-Path $logo) {
      New-BurntToastNotification -Text $Title, $Message -Sound $Sound -AppLogo $logo
    } else {
      New-BurntToastNotification -Text $Title, $Message -Sound $Sound
    }
  }
} catch {
  try { [System.Media.SystemSounds]::Exclamation.Play() } catch {}
}
```

- [ ] **Step 2: Create focus.vbs**

```vbscript
' Zero-window launcher for focus-window.ps1
Set shell = CreateObject("WScript.Shell")
home = shell.ExpandEnvironmentStrings("%USERPROFILE%")
' Try npm global path first, then standalone path
Dim scriptPath
scriptPath = home & "\.ai-agent-notifier\assets\windows\focus-window.ps1"
If Not CreateObject("Scripting.FileSystemObject").FileExists(scriptPath) Then
  ' Resolve from same directory as this VBS
  scriptPath = Replace(WScript.ScriptFullName, WScript.ScriptName, "") & "focus-window.ps1"
End If
If WScript.Arguments.Count > 0 Then
  arg = WScript.Arguments(0)
  shell.Run "pwsh -NoProfile -ExecutionPolicy Bypass -File """ & scriptPath & """ """ & arg & """", 0, False
End If
```

- [ ] **Step 3: Create focus-window.ps1**

This is the Win32 window focus script from the existing setup, updated to use `agentfocus://` protocol.

```powershell
param([string]$Arg)

$raw = $Arg -replace '^agentfocus:(//)?',''
$query = $null
if ($raw -match '\?(.+)$') {
  $query = $matches[1]
  $raw = $raw -replace '\?.+$',''
}
$target = [uri]::UnescapeDataString(($raw -replace '/$',''))

$requestedHwnd = [IntPtr]::Zero
if ($query) {
  foreach ($pair in ($query -split '&')) {
    $kv = $pair -split '=', 2
    if ($kv.Count -eq 2 -and $kv[0] -eq 'hwnd') {
      $parsed = [int64]0
      if ([int64]::TryParse($kv[1], [ref]$parsed) -and $parsed -ne 0) {
        $requestedHwnd = [IntPtr]::new($parsed)
      }
    }
  }
}

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinUtil {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
    public static List<KeyValuePair<IntPtr,string>> EnumerateTopLevelWindows() {
        var list = new List<KeyValuePair<IntPtr,string>>();
        EnumWindows((h, l) => {
            if (!IsWindowVisible(h)) return true;
            int len = GetWindowTextLength(h);
            if (len == 0) return true;
            var sb = new StringBuilder(len + 1);
            GetWindowText(h, sb, sb.Capacity);
            list.Add(new KeyValuePair<IntPtr,string>(h, sb.ToString()));
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
"@

function Focus-Window($h) {
  if ([WinUtil]::IsIconic($h)) { [WinUtil]::ShowWindow($h, 9) | Out-Null }
  [WinUtil]::BringWindowToTop($h) | Out-Null
  [WinUtil]::SwitchToThisWindow($h, $true)
  [WinUtil]::SetForegroundWindow($h) | Out-Null
}

if ($requestedHwnd -ne [IntPtr]::Zero -and [WinUtil]::IsWindow($requestedHwnd)) {
  Focus-Window $requestedHwnd
  return
}

if (-not $target) { return }
$targetLower = $target.ToLower()
$all = [WinUtil]::EnumerateTopLevelWindows()
$candidates = $all | Where-Object { $_.Value.ToLower().Contains($targetLower) }

$terminalPatterns = @('Windows Terminal','WindowsTerminal','pwsh','PowerShell','Warp','WezTerm','Alacritty','Hyper','ConEmu','cmd.exe','Command Prompt','tmux')

$hit = $candidates | Where-Object {
  $t = $_.Value
  foreach ($pat in $terminalPatterns) { if ($t -match [regex]::Escape($pat)) { return $true } }
  return $false
} | Select-Object -First 1

if (-not $hit) { $hit = $candidates | Where-Object { $_.Value -match 'Visual Studio Code$' } | Select-Object -First 1 }
if (-not $hit) { $hit = $candidates | Where-Object { $_.Value -match 'Cursor' } | Select-Object -First 1 }
if (-not $hit) { $hit = $candidates | Select-Object -First 1 }

if ($hit) { Focus-Window $hit.Key }
```

- [ ] **Step 4: Create windows.mjs**

```javascript
// src/platforms/windows.mjs
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOAST_SCRIPT = path.join(__dirname, '..', '..', 'assets', 'windows', 'toast.ps1');

export function sendToast(notification) {
  return new Promise((resolve) => {
    const args = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TOAST_SCRIPT,
      '-Title', notification.title,
      '-Message', notification.message,
      '-Sound', notification.sound || 'Default',
    ];

    if (notification.projectName) {
      args.push('-ProjectName', notification.projectName);
    }

    execFile('pwsh', args, { timeout: 10000 }, (err) => {
      resolve(!err);
    });
  });
}
```

- [ ] **Step 5: Manually test the toast on Windows**

Run: `pwsh -NoProfile -ExecutionPolicy Bypass -File assets/windows/toast.ps1 -Title "ai-agent-notifier" -Message "Test toast" -Sound "IM"`
Expected: Windows toast notification appears

- [ ] **Step 6: Commit**

```bash
git add src/platforms/windows.mjs assets/windows/
git commit -m "feat: Windows toast backend with BurntToast and click-to-focus"
```

---

### Task 7: macOS + Linux Toast Backends

**Files:**
- Create: `src/platforms/macos.mjs`
- Create: `src/platforms/linux.mjs`

- [ ] **Step 1: Create macos.mjs**

```javascript
// src/platforms/macos.mjs
import { execFile } from 'node:child_process';

export function sendToast(notification) {
  return new Promise((resolve) => {
    const sound = notification.sound || 'default';
    const script = `display notification "${esc(notification.message)}" with title "${esc(notification.title)}" sound name "${esc(sound)}"`;

    execFile('osascript', ['-e', script], { timeout: 5000 }, (err) => {
      resolve(!err);
    });
  });
}

function esc(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
```

- [ ] **Step 2: Create linux.mjs**

```javascript
// src/platforms/linux.mjs
import { execFile } from 'node:child_process';
import { getConfigDir } from '../config-loader.mjs';
import path from 'node:path';
import fs from 'node:fs';

const URGENCY_MAP = {
  urgent: 'critical',
  high: 'normal',
  default: 'low',
  low: 'low',
};

export function sendToast(notification) {
  return new Promise((resolve) => {
    const iconPath = path.join(getConfigDir(), 'icon.png');
    const args = [
      notification.title,
      notification.message,
      '--urgency', URGENCY_MAP[notification.ntfyPriority] || 'low',
    ];

    if (fs.existsSync(iconPath)) {
      args.push('--icon', iconPath);
    }

    execFile('notify-send', args, { timeout: 5000 }, (err) => {
      resolve(!err); // silent fail if notify-send not found
    });
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/platforms/macos.mjs src/platforms/linux.mjs
git commit -m "feat: macOS (osascript) and Linux (notify-send) toast backends"
```

---

### Task 8: Entry Point (notify.mjs)

**Files:**
- Create: `src/notify.mjs`

- [ ] **Step 1: Write notify.mjs**

```javascript
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
```

- [ ] **Step 2: Test manually with simulated stdin**

Run on Windows:
```bash
echo '{"session_id":"test","cwd":"C:\\Users\\amind\\my-project","hook_event_name":"Stop"}' | node src/notify.mjs --source claude
```
Expected: Windows toast appears with "Claude Code — my-project: Task complete"

- [ ] **Step 3: Commit**

```bash
git add src/notify.mjs
git commit -m "feat: entry point wiring stdin -> parse -> route -> toast + ntfy"
```

---

### Task 9: Config Patcher

**Files:**
- Create: `tests/patch-config.test.mjs`
- Create: `setup/patch-config.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/patch-config.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpDir = path.join(os.tmpdir(), 'patch-config-test-' + Date.now());

describe('patch-config', () => {
  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('creates hooks.json for Codex when none exists', async () => {
    const { patchCodex } = await import('../setup/patch-config.mjs');
    const codexDir = path.join(tmpDir, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    patchCodex(codexDir, '/path/to/notify.mjs');
    const hooks = JSON.parse(fs.readFileSync(path.join(codexDir, 'hooks.json'), 'utf8'));
    assert.ok(hooks.hooks.Stop);
    assert.ok(hooks.hooks.PermissionRequest);
  });

  it('merges into existing Claude settings.json without overwriting', async () => {
    const { patchClaude } = await import('../setup/patch-config.mjs');
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const existing = {
      model: 'claude-opus-4-6',
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }]
      }
    };
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(existing));
    patchClaude(claudeDir, '/path/to/notify.mjs');
    const result = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    // Existing keys preserved
    assert.equal(result.model, 'claude-opus-4-6');
    assert.ok(result.hooks.PreToolUse);
    // New hooks added
    assert.ok(result.hooks.Notification);
    assert.ok(result.hooks.Stop);
  });

  it('creates backup before first patch', async () => {
    const { patchClaude } = await import('../setup/patch-config.mjs');
    const claudeDir = path.join(tmpDir, '.claude2');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{"model":"test"}');
    const backupDir = path.join(tmpDir, 'backups');
    patchClaude(claudeDir, '/path/to/notify.mjs', backupDir);
    const backups = fs.readdirSync(backupDir);
    assert.ok(backups.length > 0);
  });

  it('tags managed hooks for uninstall', async () => {
    const { patchCursor } = await import('../setup/patch-config.mjs');
    const cursorDir = path.join(tmpDir, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });
    patchCursor(cursorDir, '/path/to/notify.mjs');
    const hooks = JSON.parse(fs.readFileSync(path.join(cursorDir, 'hooks.json'), 'utf8'));
    const stopHook = hooks.hooks.stop[0];
    assert.equal(stopHook._managed_by, 'ai-agent-notifier');
  });

  it('is idempotent — does not duplicate hooks on re-run', async () => {
    const { patchClaude } = await import('../setup/patch-config.mjs');
    const claudeDir = path.join(tmpDir, '.claude3');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{}');
    patchClaude(claudeDir, '/path/to/notify.mjs');
    patchClaude(claudeDir, '/path/to/notify.mjs');
    const result = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    // Should have exactly one ai-agent-notifier hook per event, not duplicates
    const notifHooks = result.hooks.Notification;
    const managedCount = notifHooks.filter(h =>
      h.hooks?.some(hh => hh.command?.includes('ai-agent-notifier') || hh.command?.includes('notify.mjs'))
    ).length;
    assert.equal(managedCount, 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/patch-config.test.mjs`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```javascript
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

function makeHookEntry(notifyPath, source, tag) {
  const entry = {
    hooks: [{
      type: 'command',
      command: `node "${notifyPath}" --source ${source}`,
      timeout: 10,
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

  const hook = makeHookEntry(notifyPath, 'claude', true);
  hook.matcher = '';

  // Remove old managed hooks, then add fresh
  settings.hooks.Notification = [...removeManagedHooks(settings.hooks.Notification), hook];
  settings.hooks.Stop = [...removeManagedHooks(settings.hooks.Stop), hook];

  writeJSON(settingsPath, settings);
}

export function patchCodex(codexDir, notifyPath, backupDir) {
  const hooksPath = path.join(codexDir, 'hooks.json');
  backup(hooksPath, backupDir);
  const existing = readJSON(hooksPath) || { hooks: {} };
  if (!existing.hooks) existing.hooks = {};

  const stopHook = makeHookEntry(notifyPath, 'codex', true);
  const permHook = makeHookEntry(notifyPath, 'codex', true);
  permHook.matcher = '';

  existing.hooks.Stop = [...removeManagedHooks(existing.hooks.Stop), stopHook];
  existing.hooks.PermissionRequest = [...removeManagedHooks(existing.hooks.PermissionRequest), permHook];

  writeJSON(hooksPath, existing);

  // Enable codex_hooks feature flag in config.toml
  const tomlPath = path.join(codexDir, 'config.toml');
  let toml = '';
  try { toml = fs.readFileSync(tomlPath, 'utf8'); } catch { /* new file */ }
  if (!toml.includes('codex_hooks')) {
    if (!toml.includes('[features]')) {
      toml += '\n[features]\ncodex_hooks = true\n';
    } else {
      toml = toml.replace('[features]', '[features]\ncodex_hooks = true');
    }
    fs.writeFileSync(tomlPath, toml, 'utf8');
  }
}

export function patchCursor(cursorDir, notifyPath, backupDir) {
  const hooksPath = path.join(cursorDir, 'hooks.json');
  backup(hooksPath, backupDir);
  const existing = readJSON(hooksPath) || { hooks: {} };
  if (!existing.hooks) existing.hooks = {};

  const hook = makeHookEntry(notifyPath, 'cursor', true);

  existing.hooks.stop = [...removeManagedHooks(existing.hooks.stop), hook];
  existing.hooks.notification = [...removeManagedHooks(existing.hooks.notification), hook];

  writeJSON(hooksPath, existing);
}

export function patchGemini(geminiDir, notifyPath, backupDir) {
  const hooksPath = path.join(geminiDir, 'hooks.json');
  backup(hooksPath, backupDir);
  const existing = readJSON(hooksPath) || { hooks: {} };
  if (!existing.hooks) existing.hooks = {};

  const hook = makeHookEntry(notifyPath, 'gemini', true);

  existing.hooks.AfterAgent = [...removeManagedHooks(existing.hooks.AfterAgent), hook];
  existing.hooks.Notification = [...removeManagedHooks(existing.hooks.Notification), hook];

  writeJSON(hooksPath, existing);
}

export function unpatchAll(homeDir, backupDir) {
  const tools = [
    { dir: '.claude', file: 'settings.json', events: ['Notification', 'Stop'] },
    { dir: '.codex', file: 'hooks.json', events: ['Stop', 'PermissionRequest'] },
    { dir: '.cursor', file: 'hooks.json', events: ['stop', 'notification'] },
    { dir: '.gemini', file: 'hooks.json', events: ['AfterAgent', 'Notification'] },
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/patch-config.test.mjs`
Expected: 5 passing

- [ ] **Step 5: Commit**

```bash
git add setup/patch-config.mjs tests/patch-config.test.mjs
git commit -m "feat: config patcher for Claude/Codex/Cursor/Gemini with backup and idempotency"
```

---

### Task 10: CLI Entry Point + Setup Wizard

**Files:**
- Create: `cli/index.mjs`
- Create: `cli/setup.mjs`

- [ ] **Step 1: Create CLI entry point**

```javascript
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
```

- [ ] **Step 2: Create setup wizard**

```javascript
// cli/setup.mjs
import readline from 'node:readline';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execSync } from 'node:child_process';
import { getConfigDir, getConfigPath, loadConfig, saveConfig } from '../src/config-loader.mjs';
import { patchClaude, patchCodex, patchCursor, patchGemini } from '../setup/patch-config.mjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const PLATFORM = os.platform();

function ask(rl, question, defaultVal) {
  return new Promise((resolve) => {
    const suffix = defaultVal ? ` (${defaultVal})` : '';
    rl.question(`  ? ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

function askYN(rl, question, defaultYes = true) {
  return new Promise((resolve) => {
    const hint = defaultYes ? '(Y/n)' : '(y/N)';
    rl.question(`  ? ${question} ${hint}: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (!a) { resolve(defaultYes); return; }
      resolve(a === 'y' || a === 'yes');
    });
  });
}

function log(msg, color = '') {
  const colors = { green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', dim: '\x1b[2m', reset: '\x1b[0m', bold: '\x1b[1m' };
  const c = colors[color] || '';
  console.log(`${c}${msg}${colors.reset}`);
}

function detectTools() {
  const tools = [];

  // Claude Code
  const claudeDir = path.join(HOME, '.claude');
  if (fs.existsSync(path.join(claudeDir, 'settings.json'))) {
    tools.push({ name: 'claude', label: 'Claude Code', dir: claudeDir });
  }

  // Codex CLI
  const codexDir = path.join(HOME, '.codex');
  if (fs.existsSync(codexDir)) {
    tools.push({ name: 'codex', label: 'Codex CLI', dir: codexDir });
  }

  // Cursor
  const cursorDir = path.join(HOME, '.cursor');
  if (fs.existsSync(cursorDir)) {
    tools.push({ name: 'cursor', label: 'Cursor IDE', dir: cursorDir });
  }

  // Gemini CLI
  const geminiDir = path.join(HOME, '.gemini');
  if (fs.existsSync(geminiDir)) {
    tools.push({ name: 'gemini', label: 'Gemini CLI', dir: geminiDir });
  }

  return tools;
}

function generateTopic() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 16; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `ai-agent-notifier-${suffix}`;
}

function resolveNotifyPath() {
  // If running from npm global install, use the package path
  const packageNotify = path.resolve(__dirname, '..', 'src', 'notify.mjs');
  if (fs.existsSync(packageNotify)) return packageNotify;
  // Fallback to standalone install
  return path.join(getConfigDir(), 'src', 'notify.mjs');
}

function downloadIcon(destPath) {
  return new Promise((resolve) => {
    const url = 'https://claude.ai/images/claude_app_icon.png';
    const file = fs.createWriteStream(destPath);
    https.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) { file.close(); resolve(false); return; }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(true); });
    }).on('error', () => { file.close(); resolve(false); });
  });
}

function installBurntToast() {
  try {
    execSync('pwsh -NoProfile -Command "if (-not (Get-Module -ListAvailable -Name BurntToast)) { Install-Module BurntToast -Scope CurrentUser -Force -AcceptLicense }"', { stdio: 'pipe', timeout: 30000 });
    return true;
  } catch { return false; }
}

function migrateExistingTopic() {
  // Check for existing ntfy-config.json from old setup
  const oldConfig = path.join(HOME, '.claude', 'ntfy-config.json');
  try {
    const data = JSON.parse(fs.readFileSync(oldConfig, 'utf8'));
    if (data.topic) return data.topic;
  } catch { /* no old config */ }
  return null;
}

export async function run() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  log('\n  ai-agent-notifier — cross-platform AI agent notifications\n', 'bold');

  // 1. Platform
  const platLabel = PLATFORM === 'win32' ? 'Windows' : PLATFORM === 'darwin' ? 'macOS' : 'Linux';
  log(`  Detecting platform... ${platLabel}`, 'cyan');

  // 2. Detect tools
  log('  Detecting tools...', 'cyan');
  const tools = detectTools();
  const allTools = ['Claude Code', 'Codex CLI', 'Cursor IDE', 'Gemini CLI'];
  const foundNames = tools.map(t => t.label);
  for (const t of allTools) {
    if (foundNames.includes(t)) log(`    \u2713 ${t}`, 'green');
    else log(`    \u2717 ${t} (not installed)`, 'dim');
  }

  if (tools.length === 0) {
    log('\n  No supported AI tools found. Install Claude Code, Codex, Gemini CLI, or Cursor first.', 'red');
    rl.close();
    return;
  }

  // 3. Toast backend
  log('\n  Installing toast backend...', 'cyan');
  if (PLATFORM === 'win32') {
    if (installBurntToast()) log('    \u2713 BurntToast module ready', 'green');
    else log('    \u2717 BurntToast install failed — toasts may not work', 'yellow');
  } else if (PLATFORM === 'darwin') {
    log('    \u2713 osascript (built-in)', 'green');
  } else {
    try { execSync('which notify-send', { stdio: 'pipe' }); log('    \u2713 notify-send available', 'green'); }
    catch { log('    \u2717 notify-send not found — install libnotify for toasts', 'yellow'); }
  }

  // 4. Icon
  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true });
  const iconPath = path.join(configDir, 'icon.png');
  if (!fs.existsSync(iconPath)) {
    const ok = await downloadIcon(iconPath);
    if (ok) log('    \u2713 Notification icon downloaded', 'green');
    else log('    \u2717 Icon download failed (toasts will use default icon)', 'yellow');
  }

  // 5. ntfy config
  const enableNtfy = await askYN(rl, 'Enable phone notifications via ntfy?');
  const config = loadConfig();

  if (enableNtfy) {
    config.ntfy.enabled = true;
    config.ntfy.server = await ask(rl, 'ntfy server', config.ntfy.server || 'https://ntfy.sh');

    const existingTopic = migrateExistingTopic() || config.ntfy.topic;
    const topic = await ask(rl, 'ntfy topic', existingTopic || generateTopic());
    config.ntfy.topic = topic;
  } else {
    config.ntfy.enabled = false;
  }

  saveConfig(getConfigPath(), config);
  log('    \u2713 Config saved', 'green');

  // 6. Patch tool configs
  log('\n  Patching tool configs...', 'cyan');
  const notifyPath = resolveNotifyPath();
  const backupDir = path.join(configDir, 'backups');

  const patchers = {
    claude: patchClaude,
    codex: patchCodex,
    cursor: patchCursor,
    gemini: patchGemini,
  };

  for (const tool of tools) {
    try {
      patchers[tool.name](tool.dir, notifyPath, backupDir);
      log(`    \u2713 ${tool.label}`, 'green');
    } catch (err) {
      log(`    \u2717 ${tool.label}: ${err.message}`, 'red');
    }
  }
  log(`    Backed up originals to ${backupDir}`, 'dim');

  // 7. QR code for ntfy
  if (config.ntfy.enabled && config.ntfy.topic) {
    const url = `${config.ntfy.server}/${config.ntfy.topic}`;
    log('\n  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550', 'cyan');
    log('    Phone notifications — subscribe in the ntfy app', 'cyan');
    log('  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550', 'cyan');
    log(`    Topic: ${config.ntfy.topic}`);
    log(`    URL:   ${url}`);
    log('');
    log('    Install the ntfy app (Android/iOS), then subscribe to the URL above.');
  }

  // 8. Summary
  log('\n  \u2713 Setup complete. Restart your AI tools to activate.\n', 'green');

  rl.close();
}
```

- [ ] **Step 3: Make CLI executable**

Run: `chmod +x cli/index.mjs` (on Unix). On Windows, the shebang + npm bin handles this.

- [ ] **Step 4: Test the setup wizard locally**

Run: `node cli/index.mjs setup`
Expected: Interactive wizard runs, detects tools, patches configs

- [ ] **Step 5: Commit**

```bash
git add cli/index.mjs cli/setup.mjs
git commit -m "feat: CLI entry point and interactive setup wizard"
```

---

### Task 11: CLI Status, Test, Config, Uninstall Commands

**Files:**
- Create: `cli/status.mjs`
- Create: `cli/test-cmd.mjs`
- Create: `cli/config-cmd.mjs`
- Create: `cli/uninstall.mjs`

- [ ] **Step 1: Create status.mjs**

```javascript
// cli/status.mjs
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, getConfigDir } from '../src/config-loader.mjs';

function log(msg, color = '') {
  const colors = { green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', dim: '\x1b[2m', reset: '\x1b[0m', bold: '\x1b[1m' };
  console.log(`${colors[color] || ''}${msg}${colors.reset}`);
}

function checkTool(name, label, configFile) {
  const filePath = path.join(os.homedir(), name, configFile);
  if (!fs.existsSync(filePath)) return { label, status: 'not installed', events: [] };
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const hooks = data.hooks || {};
    const managed = Object.keys(hooks).filter(event =>
      Array.isArray(hooks[event]) && hooks[event].some(h =>
        h._managed_by === 'ai-agent-notifier' || h.hooks?.some(hh => hh.command?.includes('notify.mjs'))
      )
    );
    return { label, status: managed.length > 0 ? 'wired' : 'not wired', events: managed };
  } catch { return { label, status: 'config error', events: [] }; }
}

export async function run() {
  const config = loadConfig();
  const platform = os.platform();
  const platLabel = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux';
  const toastLabel = platform === 'win32' ? 'BurntToast' : platform === 'darwin' ? 'osascript' : 'notify-send';

  log('\n  ai-agent-notifier status\n', 'bold');
  log(`  Platform:    ${platLabel}`);
  log(`  Toast:       ${toastLabel}${config.toast?.clickToFocus ? ' (click-to-focus enabled)' : ''}`);

  if (config.ntfy?.enabled && config.ntfy?.topic) {
    log(`  ntfy:        ${config.ntfy.server}/${config.ntfy.topic}`);
  } else {
    log('  ntfy:        disabled', 'dim');
  }

  log('\n  Tools:', 'cyan');
  const tools = [
    checkTool('.claude', 'Claude Code', 'settings.json'),
    checkTool('.codex', 'Codex CLI', 'hooks.json'),
    checkTool('.cursor', 'Cursor IDE', 'hooks.json'),
    checkTool('.gemini', 'Gemini CLI', 'hooks.json'),
  ];

  for (const t of tools) {
    const icon = t.status === 'wired' ? '\u2713' : '\u2717';
    const color = t.status === 'wired' ? 'green' : 'dim';
    const events = t.events.length > 0 ? ` (${t.events.join(', ')})` : ` (${t.status})`;
    log(`    ${icon} ${t.label}${events}`, color);
  }

  log('\n  Events:', 'cyan');
  for (const [event, conf] of Object.entries(config.events || {})) {
    const toast = conf.toastEnabled !== false ? '\u2713' : '\u2717';
    const ntfy = conf.ntfyEnabled !== false && config.ntfy?.enabled ? '\u2713' : '\u2717';
    log(`    ${event.padEnd(18)} toast ${toast}  ntfy ${ntfy}  sound: ${conf.sound || 'Default'}`);
  }

  log('');
}
```

- [ ] **Step 2: Create test-cmd.mjs**

```javascript
// cli/test-cmd.mjs
import os from 'node:os';
import { loadConfig } from '../src/config-loader.mjs';
import { sendNtfy } from '../src/ntfy.mjs';

function log(msg, color = '') {
  const colors = { green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', reset: '\x1b[0m', bold: '\x1b[1m' };
  console.log(`${colors[color] || ''}${msg}${colors.reset}`);
}

async function getToastBackend() {
  const platform = os.platform();
  if (platform === 'win32') return (await import('../src/platforms/windows.mjs')).sendToast;
  if (platform === 'darwin') return (await import('../src/platforms/macos.mjs')).sendToast;
  return (await import('../src/platforms/linux.mjs')).sendToast;
}

export async function run(channel) {
  const config = loadConfig();
  const testNotif = {
    title: 'ai-agent-notifier',
    message: 'Test notification — if you see this, it works!',
    sound: 'Default',
    ntfyPriority: 'default',
    ntfyTags: 'test_tube',
    projectName: 'test',
  };

  log('\n  ai-agent-notifier test\n', 'bold');

  const doToast = !channel || channel === 'toast' || channel === 'both';
  const doNtfy = !channel || channel === 'ntfy' || channel === 'both';

  if (doToast) {
    log('  Sending test toast...', 'cyan');
    const sendToast = await getToastBackend();
    const ok = await sendToast(testNotif);
    log(ok ? '    \u2713 Toast sent' : '    \u2717 Toast failed', ok ? 'green' : 'red');
  }

  if (doNtfy && config.ntfy?.enabled && config.ntfy?.topic) {
    log('  Sending test ntfy push...', 'cyan');
    const ok = await sendNtfy(config.ntfy, testNotif);
    log(ok ? '    \u2713 ntfy sent' : '    \u2717 ntfy failed', ok ? 'green' : 'red');
  } else if (doNtfy) {
    log('  ntfy not configured — run "ai-agent-notifier setup" first', 'yellow');
  }

  log('');
}
```

- [ ] **Step 3: Create config-cmd.mjs**

```javascript
// cli/config-cmd.mjs
import readline from 'node:readline';
import { loadConfig, saveConfig, getConfigPath } from '../src/config-loader.mjs';

function log(msg, color = '') {
  const colors = { green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', reset: '\x1b[0m', bold: '\x1b[1m' };
  console.log(`${colors[color] || ''}${msg}${colors.reset}`);
}

function ask(rl, question, defaultVal) {
  return new Promise((resolve) => {
    const suffix = defaultVal ? ` (${defaultVal})` : '';
    rl.question(`  ? ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

function askYN(rl, question, defaultYes = true) {
  return new Promise((resolve) => {
    const hint = defaultYes ? '(Y/n)' : '(y/N)';
    rl.question(`  ? ${question} ${hint}: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (!a) { resolve(defaultYes); return; }
      resolve(a === 'y' || a === 'yes');
    });
  });
}

async function configNtfy(rl, config) {
  log('\n  ntfy Configuration\n', 'bold');
  config.ntfy.enabled = await askYN(rl, 'Enable ntfy?', config.ntfy.enabled);
  if (config.ntfy.enabled) {
    config.ntfy.server = await ask(rl, 'Server', config.ntfy.server);
    config.ntfy.topic = await ask(rl, 'Topic', config.ntfy.topic);
    config.ntfy.icon = await ask(rl, 'Icon URL', config.ntfy.icon);
    config.ntfy.click = await ask(rl, 'Click URL', config.ntfy.click);
  }
}

async function configSounds(rl, config) {
  log('\n  Sound Configuration\n', 'bold');
  log('  Windows sounds: Default, IM, Mail, Reminder, SMS, Alarm', 'dim');
  for (const [event, conf] of Object.entries(config.events)) {
    conf.sound = await ask(rl, `Sound for ${event}`, conf.sound);
  }
}

async function configEvents(rl, config) {
  log('\n  Event Configuration\n', 'bold');
  for (const [event, conf] of Object.entries(config.events)) {
    log(`  ${event}:`, 'cyan');
    conf.toastEnabled = await askYN(rl, '  Enable toast?', conf.toastEnabled !== false);
    conf.ntfyEnabled = await askYN(rl, '  Enable ntfy?', conf.ntfyEnabled !== false);
  }
}

export async function run(section) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const config = loadConfig();

  if (section === 'ntfy') await configNtfy(rl, config);
  else if (section === 'sounds') await configSounds(rl, config);
  else if (section === 'events') await configEvents(rl, config);
  else {
    // Interactive menu
    log('\n  ai-agent-notifier config\n', 'bold');
    log('  1. ntfy / webhooks');
    log('  2. Sounds');
    log('  3. Events');
    const choice = await ask(rl, 'Choose (1-3)', '1');
    if (choice === '1') await configNtfy(rl, config);
    else if (choice === '2') await configSounds(rl, config);
    else if (choice === '3') await configEvents(rl, config);
  }

  saveConfig(getConfigPath(), config);
  log('\n  \u2713 Config saved.\n', 'green');
  rl.close();
}
```

- [ ] **Step 4: Create uninstall.mjs**

```javascript
// cli/uninstall.mjs
import os from 'node:os';
import readline from 'node:readline';
import { getConfigDir } from '../src/config-loader.mjs';
import { unpatchAll } from '../setup/patch-config.mjs';
import path from 'node:path';

function log(msg, color = '') {
  const colors = { green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', reset: '\x1b[0m', bold: '\x1b[1m' };
  console.log(`${colors[color] || ''}${msg}${colors.reset}`);
}

export async function run() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  log('\n  ai-agent-notifier uninstall\n', 'bold');

  const answer = await new Promise((resolve) => {
    rl.question('  ? Remove ai-agent-notifier hooks from all tools? (y/N): ', resolve);
  });

  if (answer.trim().toLowerCase() !== 'y') {
    log('  Cancelled.\n');
    rl.close();
    return;
  }

  const backupDir = path.join(getConfigDir(), 'backups');
  unpatchAll(os.homedir(), backupDir);
  log('  \u2713 Hooks removed from all tools.', 'green');
  log(`  Backups saved to ${backupDir}`, 'dim');
  log('  Config at ~/.ai-agent-notifier/ preserved — delete manually if desired.\n', 'dim');

  rl.close();
}
```

- [ ] **Step 5: Test all commands**

```bash
node cli/index.mjs --help
node cli/index.mjs status
node cli/index.mjs test toast
```

- [ ] **Step 6: Commit**

```bash
git add cli/status.mjs cli/test-cmd.mjs cli/config-cmd.mjs cli/uninstall.mjs
git commit -m "feat: CLI status, test, config, and uninstall commands"
```

---

### Task 12: Claude Code Plugin Files

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Create: `hooks/hooks.json`
- Create: `commands/setup.md`
- Create: `commands/test.md`

- [ ] **Step 1: Create plugin.json**

```json
{
  "name": "ai-agent-notifier",
  "version": "1.0.0",
  "description": "Cross-platform notifications for AI coding agents (Claude Code, Codex, Gemini, Cursor)",
  "author": {
    "name": "DevinoSolutions",
    "url": "https://github.com/DevinoSolutions"
  },
  "repository": "https://github.com/DevinoSolutions/ai-agent-notifier",
  "license": "MIT",
  "keywords": ["notifications", "toast", "ntfy", "hooks", "cross-platform"],
  "commands": [
    "./commands/setup.md",
    "./commands/test.md"
  ]
}
```

- [ ] **Step 2: Create marketplace.json**

```json
{
  "name": "ai-agent-notifier",
  "owner": {
    "name": "DevinoSolutions",
    "url": "https://github.com/DevinoSolutions"
  },
  "metadata": {
    "description": "Cross-platform notifications for AI coding agents",
    "version": "1.0.0"
  },
  "plugins": [{
    "name": "ai-agent-notifier",
    "source": "./",
    "description": "Cross-platform notifications for AI coding agents (Claude Code, Codex, Gemini, Cursor)",
    "version": "1.0.0",
    "author": { "name": "DevinoSolutions" },
    "repository": "https://github.com/DevinoSolutions/ai-agent-notifier",
    "license": "MIT",
    "keywords": ["notifications", "toast", "ntfy", "hooks"],
    "category": "productivity",
    "tags": ["notifications", "hooks", "alerts"]
  }]
}
```

- [ ] **Step 3: Create hooks/hooks.json**

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/src/notify.mjs\" --source claude",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/src/notify.mjs\" --source claude",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 4: Create commands/setup.md**

```markdown
---
name: setup
description: Set up ai-agent-notifier notifications for all AI tools
---

Run the ai-agent-notifier setup wizard. Execute this command in the terminal:

\`\`\`bash
node "${CLAUDE_PLUGIN_ROOT}/cli/index.mjs" setup
\`\`\`

This will detect installed AI tools, configure toast notifications and ntfy push, and wire hooks for Claude Code, Codex, Gemini CLI, and Cursor.
```

- [ ] **Step 5: Create commands/test.md**

```markdown
---
name: test
description: Fire a test notification to verify ai-agent-notifier is working
---

Send a test notification through all channels. Execute this in the terminal:

\`\`\`bash
node "${CLAUDE_PLUGIN_ROOT}/cli/index.mjs" test
\`\`\`

This sends a test toast notification and ntfy push to verify everything is wired correctly.
```

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin/ hooks/ commands/
git commit -m "feat: Claude Code plugin manifest, hooks, and slash commands"
```

---

### Task 13: Integration Test with Claude and Codex

**Files:** No new files — tests run against live tool installations.

- [ ] **Step 1: Run setup wizard on your machine**

```bash
cd "C:\Users\amind\OneDrive\Desktop\Projects\CUSTOM MCPs\ai-agent-notifier"
node cli/index.mjs setup
```

Walk through the wizard. Verify:
- Claude Code, Codex, and Cursor detected
- BurntToast installed
- ntfy topic generated or migrated
- All tool configs patched
- QR code shown

- [ ] **Step 2: Verify config files were patched correctly**

```bash
# Check Claude Code
cat ~/.claude/settings.json | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const j=JSON.parse(d);console.log('Claude Notification:', !!j.hooks?.Notification);console.log('Claude Stop:', !!j.hooks?.Stop)"

# Check Codex
cat ~/.codex/hooks.json

# Check Cursor
cat ~/.cursor/hooks.json
```

- [ ] **Step 3: Test toast directly**

```bash
node cli/index.mjs test toast
```
Expected: Native toast notification appears

- [ ] **Step 4: Test ntfy directly**

```bash
node cli/index.mjs test ntfy
```
Expected: Phone notification received

- [ ] **Step 5: Test with Claude Code**

```bash
claude -p "say hello and stop"
```
Expected: When Claude finishes, a toast + ntfy notification fires via the Stop hook.

- [ ] **Step 6: Test with Codex CLI**

```bash
codex -p "say hello and stop"
```
Expected: When Codex finishes, a toast + ntfy notification fires via the Stop hook.

- [ ] **Step 7: Verify status command**

```bash
node cli/index.mjs status
```
Expected: Shows all wired tools, ntfy topic, event configuration.

- [ ] **Step 8: Commit any fixes discovered during integration testing**

```bash
git add -A
git commit -m "fix: integration test adjustments"
```

---

### Task 14: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README.md**

Cover:
- One-line description + badge placeholders
- The problem (no notifications across AI tools)
- Supported tools table (Claude, Codex, Gemini, Cursor)
- Install (`npx ai-agent-notifier setup`)
- CLI commands reference
- Configuration section
- Claude Code plugin install alternative
- Platform support (Windows/macOS/Linux)
- How it works (architecture overview)
- Contributing
- License

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with install, usage, architecture overview"
```

---

### Task 15: Push to GitHub

- [ ] **Step 1: Verify all tests pass**

```bash
node --test tests/
```
Expected: All tests pass

- [ ] **Step 2: Push to remote**

Note: The remote is currently `DevinoSolutions/claude-notifier`. The repo should be renamed to `ai-agent-notifier` on GitHub first, or we push and rename later.

```bash
git push -u origin main
```

- [ ] **Step 3: Test npx install from published package**

After publishing to npm:
```bash
npx ai-agent-notifier setup
```
