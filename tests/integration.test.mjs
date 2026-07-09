// tests/integration.test.mjs — End-to-end integration tests
// Tests the full pipeline: stdin → parseInput → route → notification object
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseInput } from '../src/parse-input.mjs';
import { route } from '../src/router.mjs';
import { loadConfig } from '../src/config-loader.mjs';
import { buildNtfyRequest } from '../src/ntfy.mjs';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Use default config for integration tests
const configPath = path.join(os.tmpdir(), 'integration-test-config-' + Date.now() + '.json');
const config = loadConfig(configPath);

describe('full pipeline: stdin → notification', () => {
  it('Claude Code Stop → toast + ntfy notification', () => {
    const stdin = { hook_event_name: 'Stop', cwd: '/home/user/my-app', session_id: 'abc' };
    const event = parseInput(stdin, 'claude');
    const notification = route(event, config);

    assert.equal(notification.title, 'Claude Code');
    assert.equal(notification.message, 'my-app: Task complete');
    assert.equal(notification.toastSound, 'IM');
    assert.equal(notification.source, 'claude');
    assert.equal(notification.cwd, '/home/user/my-app');
  });

  it('Codex PermissionRequest → urgent ntfy push', () => {
    const stdin = { hook_event_name: 'PermissionRequest', cwd: '/work/backend', session_id: 'x' };
    const event = parseInput(stdin, 'codex');
    const notification = route(event, config);

    assert.equal(notification.title, 'Codex');
    assert.equal(notification.message, 'backend: Needs your input');
    assert.equal(notification.priority, 'urgent');
  });

  it('Cursor stop via --event flag (no stdin hook_event_name)', () => {
    const stdin = { status: 'completed', loop_count: 0 };
    const event = parseInput(stdin, 'cursor', 'stop');
    const notification = route(event, config);

    assert.equal(notification.title, 'Cursor');
    assert.equal(notification.message, 'Task complete');
    assert.equal(notification.source, 'cursor');
  });

  it('Gemini AfterAgent → task complete notification', () => {
    const stdin = { hook_event_name: 'AfterAgent', cwd: '/dev/frontend', session_id: 'g1' };
    const event = parseInput(stdin, 'gemini');
    const notification = route(event, config);

    assert.equal(notification.title, 'Gemini');
    assert.equal(notification.message, 'frontend: Task complete');
  });

  it('unknown event produces null notification (no-op)', () => {
    const stdin = { hook_event_name: 'PreToolUse', cwd: '/x', session_id: 's' };
    const event = parseInput(stdin, 'claude');
    const notification = route(event, config);

    assert.equal(notification, null);
  });

  it('empty stdin with --event override still works', () => {
    const event = parseInput({}, 'codex', 'Stop');
    const notification = route(event, config);

    assert.equal(notification.title, 'Codex');
    assert.ok(notification.message.includes('Task complete'));
  });
});

describe('full pipeline: notification → ntfy request', () => {
  const ntfyConfig = {
    server: 'https://ntfy.sh',
    topic: 'test-integration-xyz',
  };

  it('task_complete produces default priority ntfy request', () => {
    const stdin = { hook_event_name: 'Stop', cwd: '/app', session_id: 's' };
    const event = parseInput(stdin, 'claude');
    const notification = route(event, config);
    const req = buildNtfyRequest(ntfyConfig, notification);

    assert.equal(req.url, 'https://ntfy.sh/test-integration-xyz');
    assert.equal(req.headers.Title, 'Claude Code');
    assert.equal(req.headers.Priority, 'default');
    assert.ok(req.body.includes('app'));
    assert.ok(req.body.includes('Task complete'));
  });

  it('needs_input produces urgent priority ntfy request', () => {
    const stdin = { hook_event_name: 'Notification', cwd: '/project', session_id: 's' };
    const event = parseInput(stdin, 'claude');
    const notification = route(event, config);
    const req = buildNtfyRequest(ntfyConfig, notification);

    assert.equal(req.headers.Priority, 'urgent');
    assert.ok(req.headers.Tags.includes('bell'));
  });
});

describe('edge cases', () => {
  it('handles cwd with deeply nested path', () => {
    const stdin = { hook_event_name: 'Stop', cwd: '/a/b/c/d/e/project-name', session_id: 's' };
    const event = parseInput(stdin, 'claude');
    assert.equal(event.projectName, 'project-name');
    const notification = route(event, config);
    assert.equal(notification.message, 'project-name: Task complete');
  });

  it('handles cwd with spaces in path', () => {
    const stdin = { hook_event_name: 'Stop', cwd: '/Users/dev/My Projects/cool app', session_id: 's' };
    const event = parseInput(stdin, 'claude');
    assert.equal(event.projectName, 'cool app');
  });

  it('handles Windows cwd with backslashes', () => {
    const stdin = { hook_event_name: 'Stop', cwd: 'C:\\Users\\dev\\repos\\my-app', session_id: 's' };
    const event = parseInput(stdin, 'claude');
    assert.equal(event.projectName, 'my-app');
  });

  it('all four sources produce valid notifications for task_complete', () => {
    const sources = ['claude', 'codex', 'gemini', 'cursor'];
    const events = { claude: 'Stop', codex: 'Stop', gemini: 'AfterAgent', cursor: 'stop' };

    for (const source of sources) {
      const stdin = { hook_event_name: events[source], cwd: `/work/${source}-project`, session_id: 'x' };
      const event = parseInput(stdin, source);
      const notification = route(event, config);
      assert.ok(notification, `${source} should produce notification`);
      assert.ok(notification.title, `${source} should have title`);
      assert.ok(notification.message.includes('Task complete'), `${source} should have task_complete message`);
    }
  });

  it('session_start events are routed correctly', () => {
    const stdin = { hook_event_name: 'SessionStart', cwd: '/app', session_id: 's' };
    const event = parseInput(stdin, 'claude');
    const notification = route(event, config);
    assert.ok(notification.message.includes('Session started'));
  });

  it('hookEventName camelCase variant is supported', () => {
    const stdin = { hookEventName: 'Stop', cwd: '/app', session_id: 's' };
    const event = parseInput(stdin, 'claude');
    assert.equal(event.event, 'task_complete');
  });
});

// Cleanup
after(() => {
  try { fs.unlinkSync(configPath); } catch {}
});
