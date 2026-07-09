import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../src/router.mjs';

const defaultConfig = {
  events: {
    task_complete: { toastSound: 'IM', priority: 'default', ntfyTags: 'white_check_mark' },
    needs_input: { toastSound: 'Reminder', priority: 'urgent', ntfyTags: 'bell,warning' },
    session_start: { toastSound: 'Default', priority: 'low', ntfyTags: 'rocket' },
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
    assert.equal(notif.toastSound, 'IM');
    assert.equal(notif.priority, 'default');
    assert.equal(notif.ntfyTags, 'white_check_mark');
  });

  it('routes needs_input from codex', () => {
    const event = { source: 'codex', event: 'needs_input', projectName: 'backend' };
    const notif = route(event, defaultConfig);
    assert.equal(notif.title, 'Codex');
    assert.equal(notif.message, 'backend: Needs your input');
    assert.equal(notif.toastSound, 'Reminder');
    assert.equal(notif.priority, 'urgent');
  });

  it('routes session_start with low priority and rocket tag', () => {
    const event = { source: 'claude', event: 'session_start', projectName: 'app' };
    const notif = route(event, defaultConfig);
    assert.equal(notif.title, 'Claude Code');
    assert.equal(notif.message, 'app: Session started');
    assert.equal(notif.priority, 'low');
    assert.equal(notif.ntfyTags, 'rocket');
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
