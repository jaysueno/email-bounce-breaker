// Tests for lib/email-breaker.js. Zero dependencies: node:test and node:assert only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { breakerVerdict, BREAKER_DEFAULTS, assignVariant, pickTemplate } from '../lib/email-breaker.js';
import { isHardBounceType } from '../lib/resend-bounce.js';

const tier = (sentInWindow, hardBounced) => breakerVerdict({ sentInWindow, hardBounced }).tier;
const md5Hex = (s) => createHash('md5').update(s).digest('hex');

test('invariant 2: unclassifiable bounce counts toward stop', () => {
  // A window of 250 sends whose 13 bounces carry no type (rows written before the parser fix).
  const stored = Array(13).fill(null);
  const counted = stored.filter((t) => isHardBounceType(t) !== false).length;
  assert.equal(counted, 13);
  assert.equal(tier(250, counted), 'stop');
  // The same window with 13 transient bounces is not list rot and must not stop.
  const transient = Array(13).fill('Transient').filter((t) => isHardBounceType(t) !== false).length;
  assert.equal(transient, 0);
  assert.equal(tier(250, transient), 'none');
});

test('invariant 3: campaign breaker warns at 2% after 100 and stops at 5% after 250', () => {
  assert.equal(tier(99, 50), 'none'); // not armed below 100 sends, whatever the rate
  assert.equal(tier(100, 1), 'none'); // 1%
  assert.equal(tier(100, 2), 'warn'); // exactly 2%: inclusive
  assert.equal(tier(249, 100), 'warn'); // 40%, but STOP needs 250 sends
  assert.equal(tier(250, 12), 'warn'); // 4.8%
  assert.equal(tier(250, 13), 'stop'); // 5.2%
  assert.equal(tier(400, 19), 'warn'); // 4.75%
  assert.equal(tier(400, 20), 'stop'); // exactly 5%: inclusive
});

test('defaults are the published numbers and cannot be mutated', () => {
  assert.deepEqual({ ...BREAKER_DEFAULTS }, { warnMin: 100, warnPct: 0.02, stopMin: 250, stopPct: 0.05 });
  assert.ok(Object.isFrozen(BREAKER_DEFAULTS));
});

test('verdict reports rate, armed and the inputs', () => {
  assert.deepEqual(breakerVerdict({ sentInWindow: 200, hardBounced: 5 }),
    { tier: 'warn', rate: 0.025, sentInWindow: 200, hardBounced: 5, armed: true });
  assert.equal(breakerVerdict({ sentInWindow: 50, hardBounced: 5 }).armed, false);
});

test('no denominator means no evidence: zero, missing and NaN inputs', () => {
  assert.deepEqual(breakerVerdict(), { tier: 'none', rate: 0, sentInWindow: 0, hardBounced: 0, armed: false });
  assert.equal(breakerVerdict({ sentInWindow: 0, hardBounced: 3 }).rate, 0);
  assert.equal(breakerVerdict({ sentInWindow: NaN, hardBounced: NaN }).tier, 'none');
  assert.equal(breakerVerdict({ sentInWindow: '300', hardBounced: '30' }).tier, 'stop');
});

test('thresholds can be overridden per call', () => {
  assert.equal(breakerVerdict({ sentInWindow: 10, hardBounced: 1, warnMin: 10, stopMin: 10, stopPct: 0.1 }).tier, 'stop');
});

test('assignVariant is deterministic per identity', () => {
  for (const id of ['customer-1', 'email:someone@example.com', 'customer-42']) {
    assert.equal(assignVariant(id, 50, md5Hex), assignVariant(id, 50, md5Hex));
  }
});

test('assignVariant falls back to arm a on a missing or nonsensical split', () => {
  for (const pct of [0, 100, -5, 'x', undefined, NaN]) assert.equal(assignVariant('customer-1', pct, md5Hex), 'a');
  assert.equal(assignVariant('', 50, md5Hex), 'a');
  assert.equal(assignVariant(null, 50, md5Hex), 'a');
});

test('assignVariant splits a population close to the requested percent', () => {
  let b = 0;
  for (let i = 0; i < 2000; i++) if (assignVariant(`customer-${i}`, 30, md5Hex) === 'b') b++;
  assert.ok(b > 500 && b < 700, `arm b got ${b} of 2000`);
});

test('pickTemplate: a promoted winner overrides the assigned arm', () => {
  const base = { templateId: 'tpl-a', variantBTemplateId: 'tpl-b' };
  assert.equal(pickTemplate({ ...base, variant: 'a' }), 'tpl-a');
  assert.equal(pickTemplate({ ...base, variant: 'b' }), 'tpl-b');
  assert.equal(pickTemplate({ ...base, variant: 'a', variantWinner: 'b' }), 'tpl-b');
  assert.equal(pickTemplate({ ...base, variant: 'b', variantWinner: 'a' }), 'tpl-a');
  assert.equal(pickTemplate({ templateId: 'tpl-a', variant: 'b' }), 'tpl-a'); // no B template: control
});
