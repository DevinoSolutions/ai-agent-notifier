// tests/e2e/ntfy-roundtrip.e2e.test.mjs — real HTTP delivery to ntfy.sh
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { seedTempHome, writeUserConfig, runNode, ntfyPoll, randomTopic } from './helpers.mjs';

describe('ntfy round-trip via `test ntfy`', () => {
  const home = seedTempHome();
  after(() => fs.rmSync(home, { recursive: true, force: true }));

  it('delivers a real push that we can read back from ntfy.sh', async () => {
    const topic = randomTopic();
    writeUserConfig(home, { ntfy: { enabled: true, server: 'https://ntfy.sh', topic } });

    const res = runNode(['cli/index.mjs', 'test', 'ntfy'], { home });
    assert.equal(res.status, 0, `test ntfy exited non-zero: ${res.stderr}`);

    const msg = await ntfyPoll({
      topic,
      match: (m) => m.title === 'anotifier' && /Test notification/.test(m.message || ''),
    });
    assert.ok(msg, 'expected the test notification to arrive at ntfy.sh');
    assert.equal(msg.title, 'anotifier');
  });
});
