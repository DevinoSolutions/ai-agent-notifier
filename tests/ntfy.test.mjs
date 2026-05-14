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
