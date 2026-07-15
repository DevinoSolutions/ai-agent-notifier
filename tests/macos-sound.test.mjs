// tests/macos-sound.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { macSoundName } from '../src/platforms/macos.mjs';

test('Default and empty map to null (omit sound clause → system default)', () => {
  assert.equal(macSoundName('Default'), null);
  assert.equal(macSoundName(''), null);
  assert.equal(macSoundName(undefined), null);
});

test('Windows shipped names map to real macOS sounds', () => {
  assert.equal(macSoundName('IM'), 'Glass');       // default-config task_complete
  assert.equal(macSoundName('Reminder'), 'Ping');  // default-config needs_input
  assert.equal(macSoundName('Mail'), 'Purr');
  assert.equal(macSoundName('SMS'), 'Tink');
});

test('Alarm/Call families collapse to Sosumi', () => {
  assert.equal(macSoundName('Alarm'), 'Sosumi');
  assert.equal(macSoundName('Alarm10'), 'Sosumi');
  assert.equal(macSoundName('Call'), 'Sosumi');
  assert.equal(macSoundName('Call3'), 'Sosumi');
});

test('valid macOS system sounds pass through unchanged', () => {
  for (const s of ['Basso', 'Glass', 'Ping', 'Sosumi', 'Submarine', 'Tink']) {
    assert.equal(macSoundName(s), s);
  }
});

test('unknown names map to null (omit → never emit an invalid sound name arg)', () => {
  assert.equal(macSoundName('NotARealSound'), null);
});
