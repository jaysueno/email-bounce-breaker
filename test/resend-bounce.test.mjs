// Tests for lib/resend-bounce.js. Zero dependencies: node:test and node:assert only.
// The fixture has the shape of Resend's documented email.bounced example; every value is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  readBounce,
  isHardBounceType,
  BOUNCE_PERMANENT,
  BOUNCE_TRANSIENT,
  BOUNCE_UNDETERMINED,
} from '../lib/resend-bounce.js';

const event = JSON.parse(readFileSync(new URL('./fixtures/email-bounced.json', import.meta.url), 'utf8'));

// A caller that selects suppression or breaker evidence: hard OR unknown, never a definite "no".
const isEvidence = (storedType) => isHardBounceType(storedType) !== false;

test('fixture has the documented email.bounced shape (nested data.bounce, no flat bounce_type)', () => {
  assert.equal(event.type, 'email.bounced');
  assert.equal(typeof event.data.bounce, 'object');
  for (const key of ['type', 'subType', 'message']) assert.ok(key in event.data.bounce, key);
  assert.equal('bounce_type' in event.data, false);
});

test('invariant 1: real email.bounced payload classifies hard', () => {
  const r = readBounce(event.data);
  assert.equal(r.isHard, true);
  assert.equal(r.type, BOUNCE_PERMANENT);
  assert.equal(r.subType, 'general');
  assert.equal(r.message, event.data.bounce.message);
});

test('legacy flat read yields empty: the original bug, pinned on the real payload shape', () => {
  // What the old webhook did: read a flat field Resend never sends.
  const oldRead = String(event.data.bounce_type || '').toLowerCase();
  assert.equal(oldRead, '');
  assert.equal(oldRead === 'hard' || oldRead === 'permanent_fail', false);
});

test('invariant 7: transient bounce is never suppression evidence', () => {
  for (const subType of ['General', 'MailboxFull', 'MessageTooLarge', 'ContentRejected', 'AttachmentRejected']) {
    assert.equal(readBounce({ bounce: { type: 'Transient', subType } }).isHard, false, subType);
  }
  assert.equal(isHardBounceType('Transient'), false);
  assert.equal(isHardBounceType(BOUNCE_TRANSIENT), false);
  assert.equal(isEvidence('Transient'), false);
  // ...while hard and unknown still are.
  assert.equal(isEvidence('Permanent'), true);
  assert.equal(isEvidence(null), true);
});

test('undetermined is not hard', () => {
  assert.equal(readBounce({ bounce: { type: 'Undetermined', subType: 'Undetermined' } }).isHard, false);
  assert.equal(isHardBounceType(BOUNCE_UNDETERMINED), false);
});

test('legacy flat bounce_type still classifies when it is the only field', () => {
  assert.equal(readBounce({ bounce_type: 'hard' }).isHard, true);
  assert.equal(readBounce({ bounce_type: 'permanent_fail' }).isHard, true);
  assert.equal(readBounce({ bounce_type: 'soft' }).isHard, false);
});

test('nested type wins over a stale flat field', () => {
  assert.equal(readBounce({ bounce: { type: 'Transient' }, bounce_type: 'hard' }).isHard, false);
});

test('snake_case sub_type is read', () => {
  assert.equal(readBounce({ bounce: { type: 'Permanent', sub_type: 'General' } }).subType, 'general');
});

test('degenerate input never throws and is never hard', () => {
  assert.equal(readBounce({}).isHard, false);
  assert.equal(readBounce().isHard, false);
  assert.equal(readBounce({ bounce: null }).isHard, false);
  assert.equal(readBounce({}).message, null);
});

test('stored type: null is unknown, not soft', () => {
  assert.equal(isHardBounceType(null), null);
  assert.equal(isHardBounceType(undefined), null);
  assert.equal(isHardBounceType('Permanent'), true);
  assert.equal(isHardBounceType('hard'), true);
  assert.equal(isHardBounceType('Transient'), false);
});
