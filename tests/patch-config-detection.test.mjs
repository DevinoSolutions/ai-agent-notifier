// tests/patch-config-detection.test.mjs — the shared hook-detection predicate
// (CL-03), patch/unpatch event-map symmetry (CL-15), unpatchAll per-tool results
// (CL-07), and empty-vs-corrupt read behavior (CL-02).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  patchClaude, patchCursor, patchGemini, unpatchAll,
  detectManagedEvents, isManagedHookEntry,
} from '../setup/patch-config.mjs';

const NOTIFY = '/home/user/.npm/ai-agent-notifier/src/notify.mjs';
const tmpDir = path.join(os.tmpdir(), 'patch-detect-test-' + Date.now());

describe('isManagedHookEntry (shared predicate)', () => {
  it('matches Cursor flat { command } entries', () => {
    assert.equal(isManagedHookEntry({ command: `node "${NOTIFY}" --source cursor --event stop` }), true);
  });
  it('matches Claude/Codex nested { hooks: [{ command }] } entries', () => {
    assert.equal(isManagedHookEntry({ hooks: [{ type: 'command', command: `node "${NOTIFY}"` }] }), true);
  });
  it('matches the _managed_by tag', () => {
    assert.equal(isManagedHookEntry({ _managed_by: 'ai-agent-notifier', hooks: [] }), true);
  });
  it('does not match unrelated user hooks', () => {
    assert.equal(isManagedHookEntry({ command: 'echo hi' }), false);
    assert.equal(isManagedHookEntry({ hooks: [{ command: 'echo hi' }] }), false);
    assert.equal(isManagedHookEntry(null), false);
    assert.equal(isManagedHookEntry('nope'), false);
  });
});

describe('detectManagedEvents (status detection source of truth)', () => {
  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('reports a wired Cursor with its flat-format events (CL-03 regression)', () => {
    const cursorDir = path.join(tmpDir, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });
    patchCursor(cursorDir, NOTIFY);
    const hooks = JSON.parse(fs.readFileSync(path.join(cursorDir, 'hooks.json'), 'utf8'));
    assert.deepEqual(detectManagedEvents(hooks.hooks), ['stop']);
  });

  it('reports a wired Claude with its nested-format events', () => {
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    patchClaude(claudeDir, NOTIFY);
    const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    assert.deepEqual(detectManagedEvents(settings.hooks).sort(), ['Notification', 'Stop']);
  });

  it('returns [] for an un-wired or empty hooks object', () => {
    assert.deepEqual(detectManagedEvents({}), []);
    assert.deepEqual(detectManagedEvents({ Stop: [{ command: 'echo hi' }] }), []);
    assert.deepEqual(detectManagedEvents(undefined), []);
  });
});

describe('patch → unpatch round-trip is byte-identical (CL-15)', () => {
  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  // Patchers and unpatchAll must touch the SAME events (derived from one
  // TOOL_EVENTS map), so removing our hooks restores a pre-existing config
  // exactly — including the file bytes.
  const roundTrip = (subDir, file, preObj, patchFn) => {
    const home = fs.mkdtempSync(path.join(tmpDir, 'home-'));
    const toolDir = path.join(home, subDir);
    fs.mkdirSync(toolDir, { recursive: true });
    const filePath = path.join(toolDir, file);
    const preContent = JSON.stringify(preObj, null, 2) + '\n';
    fs.writeFileSync(filePath, preContent);

    patchFn(toolDir, NOTIFY);
    assert.notEqual(fs.readFileSync(filePath, 'utf8'), preContent, 'patch should modify the file');

    unpatchAll(home);
    return { after: fs.readFileSync(filePath, 'utf8'), preContent };
  };

  it('Claude settings.json survives a patch/unpatch cycle unchanged', () => {
    const pre = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] } };
    const { after, preContent } = roundTrip('.claude', 'settings.json', pre, patchClaude);
    assert.equal(after, preContent);
  });

  it('Cursor hooks.json survives a patch/unpatch cycle unchanged', () => {
    const pre = { version: 1, hooks: { stop: [{ command: 'echo user-hook' }] } };
    const { after, preContent } = roundTrip('.cursor', 'hooks.json', pre, patchCursor);
    assert.equal(after, preContent);
  });

  it('Gemini settings.json survives a patch/unpatch cycle unchanged', () => {
    const pre = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] } };
    const { after, preContent } = roundTrip('.gemini', 'settings.json', pre, patchGemini);
    assert.equal(after, preContent);
  });
});

describe('unpatchAll returns per-tool results (CL-07)', () => {
  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('reports each tool: removed, nothing-to-remove, or a loud error', () => {
    const home = fs.mkdtempSync(path.join(tmpDir, 'home-'));
    // Claude is wired.
    const claudeDir = path.join(home, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    patchClaude(claudeDir, NOTIFY);
    // Cursor config is corrupt (non-empty invalid JSON).
    const cursorDir = path.join(home, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.writeFileSync(path.join(cursorDir, 'hooks.json'), '{ broken');

    const results = unpatchAll(home);
    const byTool = Object.fromEntries(results.map((r) => [r.tool, r]));

    assert.equal(byTool['Claude Code'].ok, true);
    assert.equal(byTool['Claude Code'].reason, 'hooks removed');
    assert.equal(byTool['Cursor IDE'].ok, false);
    assert.match(byTool['Cursor IDE'].reason, /not valid JSON/);
    // Gemini was never present — reported cleanly, not as a failure.
    assert.equal(byTool['Gemini CLI'].ok, true);
  });
});

describe('empty vs corrupt tool config (CL-02)', () => {
  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('treats an empty settings.json as absent (no throw, hooks written)', () => {
    const claudeDir = path.join(tmpDir, '.claude-empty');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), '   \n');
    assert.doesNotThrow(() => patchClaude(claudeDir, NOTIFY));
    const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    assert.ok(settings.hooks.Stop);
  });
});
