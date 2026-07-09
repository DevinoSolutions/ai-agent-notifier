// tests/sentry.test.mjs — envelope client unit tests. DSN parsing and event
// building are pure and tested directly. The network path is exercised for
// real ONLY when AAN_SENTRY_TEST_DSN is set (same live-gating pattern as
// AAN_TOAST_LIVE in platforms.test.mjs) — there is no mocked transport here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSentryDsn, buildErrorEvent, sendSentryErrorEvent } from '../src/sentry.mjs';

describe('parseSentryDsn', () => {
  it('extracts envelope URL and public key from a valid DSN', () => {
    const dsn = parseSentryDsn('https://abc123@sentry.example.com/42');
    assert.equal(dsn.envelopeUrl, 'https://sentry.example.com/api/42/envelope/');
    assert.equal(dsn.publicKey, 'abc123');
  });

  it('returns null for malformed DSNs', () => {
    assert.equal(parseSentryDsn(''), null);
    assert.equal(parseSentryDsn('not a url'), null);
    assert.equal(parseSentryDsn('https://sentry.example.com/42'), null); // no key
    assert.equal(parseSentryDsn('https://key@sentry.example.com/'), null); // no project
    assert.equal(parseSentryDsn('https://key@sentry.example.com/abc'), null); // non-numeric project
  });
});

describe('buildErrorEvent', () => {
  it('builds a minimal valid Sentry event', () => {
    const err = new Error('kaboom');
    err.name = 'TestError';
    const event = buildErrorEvent({ context: 'toast:windows', error: err, extra: { a: 1 } });
    assert.match(event.event_id, /^[0-9a-f]{32}$/);
    assert.equal(event.platform, 'node');
    assert.equal(event.level, 'error');
    assert.equal(event.logger, 'toast:windows');
    assert.match(event.release, /^ai-agent-notifier@\d+\.\d+\.\d+$/);
    assert.deepEqual(event.tags, { context: 'toast:windows' });
    assert.equal(event.exception.values[0].type, 'TestError');
    assert.equal(event.exception.values[0].value, 'kaboom');
    assert.equal(event.extra.a, 1);
    assert.ok(event.extra.stack.includes('kaboom'));
  });

  it('copes with non-Error inputs', () => {
    const event = buildErrorEvent({ context: 'hook', error: 'string failure' });
    assert.equal(event.exception.values[0].type, 'Error');
    assert.equal(event.exception.values[0].value, 'string failure');
  });
});

describe('sendSentryErrorEvent', () => {
  it('resolves false without touching the network when the DSN is invalid', async () => {
    const ok = await sendSentryErrorEvent({ enabled: true, dsn: 'garbage' }, { context: 'x', error: new Error('y') });
    assert.equal(ok, false);
  });

  const liveDsn = process.env.AAN_SENTRY_TEST_DSN;
  it('delivers a real event to a real Sentry project (live — set AAN_SENTRY_TEST_DSN)', { skip: !liveDsn }, async () => {
    const ok = await sendSentryErrorEvent(
      { enabled: true, dsn: liveDsn },
      { context: 'ci-live-test', error: new Error('sentry.test.mjs live delivery check (safe to resolve)') },
    );
    assert.equal(ok, true);
  });
});
