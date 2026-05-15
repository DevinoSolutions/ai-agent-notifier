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

  it('normalizes Cursor sessionEnd event', () => {
    const raw = { session_id: 'cu2', cwd: '/code/app', hook_event_name: 'sessionEnd' };
    const result = parseInput(raw, 'cursor');
    assert.equal(result.event, 'task_complete');
  });

  it('uses --event override when stdin has no hook_event_name', () => {
    // Cursor and Codex pass --event as CLI arg since they don't include hook_event_name in stdin
    const raw = { status: 'completed', loop_count: 0 };
    const result = parseInput(raw, 'cursor', 'stop');
    assert.equal(result.event, 'task_complete');
    assert.equal(result.rawEvent, 'stop');
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
