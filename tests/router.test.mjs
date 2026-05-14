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
