// tests/transcript.test.mjs — unit coverage for the F3 rich-content core:
// the shared sanitizer, the defensive transcript tail-reader, and the pure
// per-channel view derivation (with an injected reader, no filesystem).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  sanitizeNotificationText,
  readLastAssistantText,
  deriveRichViews,
} from '../src/transcript.mjs';

// Fixture builders matching the real transcript JSONL schema (verified against
// a live session file): assistant turns carry top-level `isSidechain` and a
// `message.content[]` array of text/thinking/tool_use blocks.
const asstText = (text) => JSON.stringify({
  type: 'assistant', isSidechain: false,
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});
const asstSidechain = (text) => JSON.stringify({
  type: 'assistant', isSidechain: true,
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});
const asstThinkingToolOnly = () => JSON.stringify({
  type: 'assistant', isSidechain: false,
  message: { role: 'assistant', content: [
    { type: 'thinking', thinking: 'let me think about this' },
    { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
  ] },
});
const userLine = (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });

describe('sanitizeNotificationText', () => {
  it('collapses all whitespace runs to single spaces and trims', () => {
    assert.equal(sanitizeNotificationText('  hello\n\n  world\t\ttest  '), 'hello world test');
  });

  it('flattens newline-heavy multi-paragraph text to one line', () => {
    assert.equal(sanitizeNotificationText('line1\nline2\r\nline3'), 'line1 line2 line3');
  });

  it('keeps quotes and emoji intact when under the cap', () => {
    assert.equal(sanitizeNotificationText('done 🎉 "quoted" ok'), 'done 🎉 "quoted" ok');
  });

  it('truncates past the cap with a trailing ellipsis, staying within the cap', () => {
    const out = sanitizeNotificationText('abcdefghijklmnopqrstuvwxyz', 10);
    assert.equal(out, 'abcdefghi…');
    assert.ok(out.length <= 10);
  });

  it('does not truncate text exactly at the cap', () => {
    assert.equal(sanitizeNotificationText('abcdefghij', 10), 'abcdefghij');
  });
});

describe('readLastAssistantText', () => {
  let dir;
  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-transcript-')); });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const writeJsonl = (name, lines) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, lines.join('\n') + '\n');
    return p;
  };

  it('returns the newest assistant text block', () => {
    const p = writeJsonl('basic.jsonl', [
      userLine('do the thing'),
      asstText('First reply'),
      userLine('and again'),
      asstText('Second and final reply'),
    ]);
    assert.equal(readLastAssistantText(p), 'Second and final reply');
  });

  it('skips sidechain (subagent) assistant lines', () => {
    const p = writeJsonl('sidechain.jsonl', [
      asstText('Main-agent answer'),
      asstSidechain('Subagent chatter that must not surface'),
    ]);
    assert.equal(readLastAssistantText(p), 'Main-agent answer');
  });

  it('skips assistant lines with only thinking/tool_use blocks', () => {
    const p = writeJsonl('thinking.jsonl', [
      asstText('The real user-facing answer'),
      asstThinkingToolOnly(),
    ]);
    assert.equal(readLastAssistantText(p), 'The real user-facing answer');
  });

  it('collapses whitespace in the extracted text', () => {
    const p = writeJsonl('ws.jsonl', [asstText('line one\n\n   line   two\t\tthree')]);
    assert.equal(readLastAssistantText(p), 'line one line two three');
  });

  it('truncates a very long assistant line with an ellipsis', () => {
    const p = writeJsonl('long.jsonl', [asstText('x'.repeat(500))]);
    const out = readLastAssistantText(p, { maxChars: 20 });
    assert.ok(out.length <= 20, `expected <=20 chars, got ${out.length}`);
    assert.ok(out.endsWith('…'));
    assert.ok(out.startsWith('xxx'));
  });

  it('drops the partial first line when reading only the tail (maxBytes)', () => {
    const early = asstText('EARLY assistant line that gets cut mid-record');
    const late = asstText('LATE assistant line inside the tail window');
    const p = writeJsonl('partial-first.jsonl', [early, userLine('filler between'), late]);
    const size = fs.statSync(p).size;
    // Start the read 10 bytes in so the first window line is a fragment of
    // `early`; it must be dropped and `late` returned instead. `early` never
    // appears whole in the window, proving the tail read + partial-line drop.
    const out = readLastAssistantText(p, { maxBytes: size - 10 });
    assert.equal(out, 'LATE assistant line inside the tail window');
  });

  it('tolerates a trailing partial last line (transcript mid-append)', () => {
    const good = asstText('GOOD complete assistant line');
    // A record cut off mid-write — invalid JSON, no trailing newline.
    const brokenTail = '{"type":"assistant","isSidechain":false,"message":{"content":[{"type":"text","text":"TRUNCA';
    const p = path.join(dir, 'partial-last.jsonl');
    fs.writeFileSync(p, good + '\n' + brokenTail);
    assert.equal(readLastAssistantText(p), 'GOOD complete assistant line');
  });

  it('skips malformed JSON lines without failing', () => {
    const p = writeJsonl('malformed.jsonl', [
      'this is not json at all',
      '{ broken json',
      asstText('Valid answer among the noise'),
      '<<< trailing garbage >>>',
    ]);
    assert.equal(readLastAssistantText(p), 'Valid answer among the noise');
  });

  it('returns null when no assistant text block is present', () => {
    const p = writeJsonl('no-text.jsonl', [
      userLine('just a user turn'),
      asstThinkingToolOnly(),
      asstSidechain('sidechain only'),
    ]);
    assert.equal(readLastAssistantText(p), null);
  });

  it('returns null for a missing file (normal, not an error)', () => {
    assert.equal(readLastAssistantText(path.join(dir, 'does-not-exist.jsonl')), null);
  });

  it('returns null for an empty transcript path', () => {
    assert.equal(readLastAssistantText(''), null);
  });

  it('returns null for a zero-byte file', () => {
    const p = path.join(dir, 'zero.jsonl');
    fs.writeFileSync(p, '');
    assert.equal(readLastAssistantText(p), null);
  });
});

describe('deriveRichViews', () => {
  // The shared generic notification every channel starts from.
  const generic = {
    title: 'Claude Code', message: 'app: Task complete',
    source: 'claude', event: 'task_complete', projectName: 'app',
  };
  const claudeStop = { source: 'claude', event: 'task_complete', message: '', transcriptPath: '/x.jsonl' };
  const richReader = () => 'ASSISTANT SAID THIS';
  const nullReader = () => null;

  it('toast gets rich content by default (richContent unset)', () => {
    const views = deriveRichViews(claudeStop, { toast: { enabled: true } }, {}, generic, richReader);
    assert.equal(views.toast.message, 'ASSISTANT SAID THIS');
    assert.equal(views.toast.title, 'Claude Code', 'non-message fields carried through');
  });

  it('ntfy stays generic by default even when enabled (public-topic privacy)', () => {
    const config = { toast: { enabled: false }, ntfy: { enabled: true, topic: 't' } };
    const views = deriveRichViews(claudeStop, config, {}, generic, richReader);
    assert.equal(views.ntfy, generic, 'no rich clone — the shared generic object is reused');
  });

  it('ntfy gets rich content only when ntfy.richContent === true', () => {
    const config = { toast: { enabled: false }, ntfy: { enabled: true, topic: 't', richContent: true } };
    const views = deriveRichViews(claudeStop, config, {}, generic, richReader);
    assert.equal(views.ntfy.message, 'ASSISTANT SAID THIS');
  });

  it('webhook gets rich content by default', () => {
    const config = { toast: { enabled: false }, webhook: { enabled: true, url: 'https://example.com/hook' } };
    const views = deriveRichViews(claudeStop, config, {}, generic, richReader);
    assert.equal(views.webhook.message, 'ASSISTANT SAID THIS');
  });

  it('session_start never derives rich content', () => {
    let called = false;
    const spy = () => { called = true; return 'NOPE'; };
    const ev = { source: 'claude', event: 'session_start', message: '', transcriptPath: '/x' };
    const views = deriveRichViews(ev, { toast: { enabled: true } }, {}, generic, spy);
    assert.equal(views.toast, generic);
    assert.equal(called, false);
  });

  it('non-claude sources never derive rich content', () => {
    let called = false;
    const spy = () => { called = true; return 'NOPE'; };
    const ev = { source: 'codex', event: 'task_complete', message: '', transcriptPath: '/x' };
    const views = deriveRichViews(ev, { toast: { enabled: true } }, {}, generic, spy);
    assert.equal(views.toast, generic);
    assert.equal(called, false);
  });

  it('needs_input prefers Claude\'s own message over the transcript (sanitized)', () => {
    let called = false;
    const spy = () => { called = true; return 'TRANSCRIPT TEXT'; };
    const ev = { source: 'claude', event: 'needs_input', message: '  Needs permission\nto run npm  ', transcriptPath: '/x' };
    const views = deriveRichViews(ev, { toast: { enabled: true } }, {}, generic, spy);
    assert.equal(views.toast.message, 'Needs permission to run npm');
    assert.equal(called, false, 'transcript reader must not run when a message is present');
  });

  it('needs_input falls back to the transcript when the message is empty', () => {
    const ev = { source: 'claude', event: 'needs_input', message: '', transcriptPath: '/x' };
    const views = deriveRichViews(ev, { toast: { enabled: true } }, {}, generic, richReader);
    assert.equal(views.toast.message, 'ASSISTANT SAID THIS');
  });

  it('a null transcript keeps every channel generic', () => {
    const config = {
      toast: { enabled: true },
      ntfy: { enabled: true, topic: 't', richContent: true },
      webhook: { enabled: true, url: 'https://example.com/hook' },
    };
    const views = deriveRichViews(claudeStop, config, {}, generic, nullReader);
    assert.equal(views.toast, generic);
    assert.equal(views.ntfy, generic);
    assert.equal(views.webhook, generic);
  });

  it('does not read the transcript when no rich-capable channel is enabled', () => {
    let called = false;
    const spy = () => { called = true; return 'NOPE'; };
    // ntfy enabled but richContent default-off; toast/webhook off → no reader.
    const config = { toast: { enabled: false }, ntfy: { enabled: true, topic: 't' } };
    const views = deriveRichViews(claudeStop, config, {}, generic, spy);
    assert.equal(called, false);
    assert.equal(views.ntfy, generic);
  });

  it('honors a per-event channel disable (eventConfig) when gating the read', () => {
    let called = false;
    const spy = () => { called = true; return 'NOPE'; };
    // toast enabled globally but disabled for this event → nothing rich-capable.
    const views = deriveRichViews(claudeStop, { toast: { enabled: true } }, { toastEnabled: false }, generic, spy);
    assert.equal(called, false);
    assert.equal(views.toast, generic);
  });

  it('mixed channels in one pass: toast + webhook rich, ntfy generic', () => {
    const config = {
      toast: { enabled: true },
      ntfy: { enabled: true, topic: 't' }, // default off
      webhook: { enabled: true, url: 'https://example.com/hook' },
    };
    const views = deriveRichViews(claudeStop, config, {}, generic, richReader);
    assert.equal(views.toast.message, 'ASSISTANT SAID THIS');
    assert.equal(views.webhook.message, 'ASSISTANT SAID THIS');
    assert.equal(views.ntfy, generic);
  });
});
