// tests/config-loader-validation.test.mjs — loadConfigResult must tell the
// truth about a broken user config instead of silently using defaults.
// (Split from config-loader.test.mjs the same way patch-config-advanced
// extends patch-config.)
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfigResult } from '../src/config-loader.mjs';

describe('loadConfigResult', () => {
  let dir, configPath;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aan-cfgval-'));
    configPath = path.join(dir, 'config.json');
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('missing file is NOT a problem — defaults are the contract', () => {
    const { config, problem } = loadConfigResult(configPath);
    assert.equal(problem, null);
    assert.equal(config.ntfy.server, 'https://ntfy.sh');
  });

  it('invalid JSON is reported as a parse problem, defaults still returned', () => {
    fs.writeFileSync(configPath, '{ "ntfy": { "topic": "x", }', 'utf8'); // trailing comma + unclosed
    const { config, problem } = loadConfigResult(configPath);
    assert.equal(problem.type, 'parse');
    assert.match(problem.message, /not valid JSON/);
    assert.equal(config.ntfy.topic, '', 'defaults in effect');
  });

  it('wrong-typed keys are reported AND reverted to defaults', () => {
    fs.writeFileSync(configPath, JSON.stringify({
      ntfy: { enabled: 'yes', topic: 'my-topic' },
      toast: { clickToFocus: 1 },
    }), 'utf8');
    const { config, problem } = loadConfigResult(configPath);
    assert.equal(problem.type, 'validate');
    assert.match(problem.message, /"ntfy\.enabled" must be a boolean/);
    assert.match(problem.message, /"toast\.clickToFocus" must be a boolean/);
    assert.equal(config.ntfy.enabled, true, 'bad value reverted to default');
    assert.equal(config.ntfy.topic, 'my-topic', 'good sibling value kept');
    assert.equal(config.toast.clickToFocus, true, 'bad value reverted to default');
  });

  it('legacy renamed keys get an explicit migration hint', () => {
    fs.writeFileSync(configPath, JSON.stringify({
      events: { task_complete: { sound: 'IM', ntfyPriority: 'high' } },
    }), 'utf8');
    const { problem } = loadConfigResult(configPath);
    assert.equal(problem.type, 'validate');
    assert.match(problem.message, /"events\.task_complete\.sound" was renamed to "toastSound"/);
    assert.match(problem.message, /"events\.task_complete\.ntfyPriority" was renamed to "priority"/);
  });

  it('unknown keys are reported as likely typos but kept', () => {
    fs.writeFileSync(configPath, JSON.stringify({
      ntfy: { enabled: true, topics: 'oops' },
      totally_unknown: {},
    }), 'utf8');
    const { problem } = loadConfigResult(configPath);
    assert.equal(problem.type, 'validate');
    assert.match(problem.message, /unknown key "ntfy\.topics"/);
    assert.match(problem.message, /unknown key "totally_unknown"/);
  });

  it('invalid priority values are rejected with the allowed list', () => {
    fs.writeFileSync(configPath, JSON.stringify({
      events: { needs_input: { priority: 'ASAP' } },
    }), 'utf8');
    const { config, problem } = loadConfigResult(configPath);
    assert.match(problem.message, /"events\.needs_input\.priority" must be one of min\|low\|default\|high\|urgent/);
    assert.equal(config.events.needs_input.priority, 'urgent', 'default kept');
  });

  it('webhook: unknown keys are reported but kept', () => {
    fs.writeFileSync(configPath, JSON.stringify({
      webhook: { enabled: true, url: 'https://example.com/hook', foo: 'bar' },
    }), 'utf8');
    const { config, problem } = loadConfigResult(configPath);
    assert.equal(problem.type, 'validate');
    assert.match(problem.message, /unknown key "webhook\.foo"/);
    assert.equal(config.webhook.foo, 'bar', 'unknown key kept');
  });

  it('webhook: wrong-typed keys are reported AND reverted to defaults', () => {
    fs.writeFileSync(configPath, JSON.stringify({
      webhook: { enabled: 'yes', url: 'https://example.com/hook' },
    }), 'utf8');
    const { config, problem } = loadConfigResult(configPath);
    assert.equal(problem.type, 'validate');
    assert.match(problem.message, /"webhook\.enabled" must be a boolean/);
    assert.equal(config.webhook.enabled, false, 'bad value reverted to default');
    assert.equal(config.webhook.url, 'https://example.com/hook', 'good sibling value kept');
  });

  it('webhook: an invalid format value is rejected with the allowed list', () => {
    fs.writeFileSync(configPath, JSON.stringify({
      webhook: { enabled: true, url: 'https://example.com/hook', format: 'teams' },
    }), 'utf8');
    const { config, problem } = loadConfigResult(configPath);
    assert.equal(problem.type, 'validate');
    assert.match(problem.message, /"webhook\.format" must be one of generic\|slack\|discord\|telegram/);
    assert.equal(config.webhook.format, 'generic', 'default kept');
  });

  it('webhook: telegram format without a chatId is flagged but the format is kept', () => {
    fs.writeFileSync(configPath, JSON.stringify({
      webhook: { enabled: true, url: 'https://api.telegram.org/botTOKEN/sendMessage', format: 'telegram' },
    }), 'utf8');
    const { config, problem } = loadConfigResult(configPath);
    assert.equal(problem.type, 'validate');
    assert.match(problem.message, /"webhook\.format" is "telegram" but "webhook\.chatId" is missing/);
    assert.equal(config.webhook.format, 'telegram', 'format kept so the send-time hint fires');
  });

  it('a fully valid user config produces no problem', () => {
    fs.writeFileSync(configPath, JSON.stringify({
      ntfy: { enabled: true, topic: 'aan-test' },
      webhook: { enabled: true, url: 'https://hooks.slack.com/services/T/B/X', format: 'slack' },
      sentry: { enabled: false, dsn: '' },
      events: { task_complete: { toastSound: 'Mail', priority: 'high', webhookEnabled: false } },
    }), 'utf8');
    const { config, problem } = loadConfigResult(configPath);
    assert.equal(problem, null);
    assert.equal(config.webhook.format, 'slack');
    assert.equal(config.events.task_complete.toastSound, 'Mail');
    assert.equal(config.events.task_complete.priority, 'high');
    assert.equal(config.events.task_complete.webhookEnabled, false);
  });
});
