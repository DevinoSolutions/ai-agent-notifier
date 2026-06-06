// tests/e2e/dedup.e2e.test.mjs — proves the dedup lock works under REAL
// concurrency: two notify.mjs processes for the same source, launched at once,
// must result in exactly one ntfy push (some tools fire the stop hook twice).
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { seedTempHome, writeUserConfig, runNodeAsync, ntfyCollect, randomTopic } from './helpers.mjs';

describe('dedup lock under real concurrency', () => {
  const homes = [];
  after(() => homes.forEach((h) => fs.rmSync(h, { recursive: true, force: true })));

  it('two simultaneous claude Stop hooks deliver exactly one push', async () => {
    const home = seedTempHome();
    homes.push(home);
    const topic = randomTopic('dedup');
    writeUserConfig(home, { toast: { enabled: false }, ntfy: { enabled: true, server: 'https://ntfy.sh', topic } });

    const stdin = JSON.stringify({ hook_event_name: 'Stop', cwd: '/work/dedup', session_id: 's' });
    // Launch both WITHOUT awaiting in between so they race for the exclusive lock.
    const [r1, r2] = await Promise.all([
      runNodeAsync(['src/notify.mjs', '--source', 'claude'], { home, stdin }),
      runNodeAsync(['src/notify.mjs', '--source', 'claude'], { home, stdin }),
    ]);
    assert.equal(r1.status, 0, `proc1 stderr: ${r1.stderr}`);
    assert.equal(r2.status, 0, `proc2 stderr: ${r2.stderr}`);

    const msgs = await ntfyCollect({ topic, match: (m) => m.title === 'Claude Code' });
    assert.equal(msgs.length, 1, `expected exactly one push, got ${msgs.length}`);
  });
});
