// tests/ntfy-send.test.mjs — exercises the real sendNtfy() network path against a
// real local HTTP server (no mocking). Covers success, non-2xx, unreachable, and
// the missing-topic short-circuit, plus asserts the exact bytes put on the wire.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { sendNtfy } from '../src/ntfy.mjs';

describe('sendNtfy (real local HTTP server, no mocking)', () => {
  let server;
  let base;
  let last = null;
  let statusToReturn = 200;

  before(async () => {
    await new Promise((resolve) => {
      server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          last = { method: req.method, url: req.url, headers: req.headers, body };
          res.statusCode = statusToReturn;
          res.end('ok');
        });
      });
      server.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it('returns false immediately when topic is missing (no request sent)', async () => {
    last = null;
    const ok = await sendNtfy({ server: base, topic: '' }, { title: 'T', message: 'm' });
    assert.equal(ok, false);
    assert.equal(last, null, 'no HTTP request should have been made');
  });

  it('returns true on 2xx and puts the correct method, path, headers, and body on the wire', async () => {
    statusToReturn = 200;
    const ok = await sendNtfy(
      { server: base, topic: 'my-topic' },
      { title: 'Claude Code', message: 'app: Task complete', ntfyPriority: 'urgent', ntfyTags: 'bell,warning' }
    );
    assert.equal(ok, true);
    assert.equal(last.method, 'POST');
    assert.equal(last.url, '/my-topic');
    assert.equal(last.headers.title, 'Claude Code');
    assert.equal(last.headers.priority, 'urgent');
    assert.equal(last.headers.tags, 'bell,warning');
    assert.match(last.headers['content-type'], /text\/plain/);
    assert.equal(last.body, 'app: Task complete');
  });

  it('defaults priority to "default" and omits Tags when empty', async () => {
    statusToReturn = 200;
    const ok = await sendNtfy({ server: base, topic: 't' }, { title: 'T', message: 'm', ntfyTags: '' });
    assert.equal(ok, true);
    assert.equal(last.headers.priority, 'default');
    assert.equal(last.headers.tags, undefined);
  });

  it('returns false on a 4xx response', async () => {
    statusToReturn = 404;
    const ok = await sendNtfy({ server: base, topic: 't' }, { title: 'T', message: 'm' });
    assert.equal(ok, false);
  });

  it('returns false on a 5xx response', async () => {
    statusToReturn = 500;
    const ok = await sendNtfy({ server: base, topic: 't' }, { title: 'T', message: 'm' });
    assert.equal(ok, false);
  });

  it('returns false when the server is unreachable (connection refused)', async () => {
    const ok = await sendNtfy({ server: 'http://127.0.0.1:1', topic: 't' }, { title: 'T', message: 'm' });
    assert.equal(ok, false);
  });
});
