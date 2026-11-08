/**
 * lib/email-breaker.js: the campaign bounce circuit breaker's THRESHOLD MATH, kept apart from
 * the send loop so it can be unit-tested with no database and no network.
 *
 * This module owns the NUMBERS and the verdict. It owns no queries: the send loop still decides
 * what "in-window sends" and "hard bounces of those sends" mean (it matches them by email id) and
 * passes the two integers in. That split is deliberate: the part that was impossible to test was
 * never the SQL, it was the arithmetic and the tier boundaries.
 *
 * Campaign bounce circuit breaker (RECALIBRATED 2026-07-20)
 * The 2026-07-18 breaker (>=2% of ALL bounces after 100 sends => hard pause) stopped one newsletter
 * on three consecutive mornings (round examples: 500 sent at 2%, 150 at 3%, 100 at 2%), because
 * 2 bounces out of 100 sends clears a 2% bar. At that denominator the "rate" is noise, and the
 * pause demanded a full console re-confirm each time, so the breaker was blocking the send far
 * more reliably than it was protecting the domain.
 *
 * The underlying cause was never the threshold: the hard-bounce suppressor had never fired (see
 * lib/resend-bounce.js), so the SAME dead addresses re-bounced on every wave. Fixing that drops
 * the measured rate to about 0.5% on verified addresses. Two tiers now:
 *
 *   WARN: alert, KEEP SENDING. Visibility without blocking.
 *   STOP: pause + re-confirm. Reserved for a genuinely burning list.
 *
 * Only HARD (permanent) bounces count toward STOP. A transient bounce (mailbox full, greylisting)
 * is not list rot and must never halt a campaign. Unclassifiable bounces (bounce_type NULL, i.e.
 * every row written before the 2026-07-20 parser fix) count toward STOP too: an unexplained
 * bounce is still evidence, and treating unknown as harmless is how the first bug hid.
 * Gmail/Yahoo bulk-sender guidance caps COMPLAINTS at 0.3%; bounce ceilings are an ESP norm
 * (~2% warn, ~5% danger), so STOP sits at 5% over a denominator big enough to mean something.
 */

/**
 * A/B variant assignment: pure, deterministic, and therefore safe to replay.
 *
 * Bucketed on md5(identity) rather than Math.random for one reason: the send loop rebuilds a
 * campaign's queue whenever it is re-approved, and each queued job upserts on its message key with
 * duplicates ignored. If assignment were random, a rebuild would reshuffle arms while the
 * already-sent jobs kept their original template, and the test would silently measure two
 * overlapping populations. Hashing a stable identity means the same person lands in the same arm
 * forever, no matter how many times the queue is rebuilt.
 *
 * @param {string} identity  customer_id, or `email:<addr>` for email-only recipients
 * @param {number} splitPct  percent assigned to arm B (1-99)
 * @param {(s:string)=>string} md5Hex  injected hasher (node:crypto in the send loop; keeps this pure)
 * @returns {'a'|'b'}
 */
export function assignVariant(identity, splitPct, md5Hex) {
  const pct = Number(splitPct);
  // No split configured, or a nonsensical one => everyone gets the control arm. Fail toward the
  // template a human already approved rather than toward the untested one.
  if (!Number.isFinite(pct) || pct < 1 || pct > 99) return 'a';
  if (!identity) return 'a';
  const bucket = parseInt(md5Hex(String(identity)).slice(0, 8), 16) % 100;
  return bucket < pct ? 'b' : 'a';
}

/**
 * Which template a given job actually sends.
 *
 * `variant_winner` is the override: once a human promotes an arm in the console, EVERY remaining
 * queued job sends the winner's template regardless of the arm it was assigned. That is the whole
 * point of promoting: the rest of the list should get the better subject line, not the arm a
 * hash happened to pick for them.
 *
 * Returns the control template when anything is missing, so a misconfigured A/B campaign sends
 * the approved template rather than nothing.
 */
export function pickTemplate({ templateId, variantBTemplateId, variant, variantWinner }) {
  const arm = variantWinner || variant;
  if (arm === 'b' && variantBTemplateId) return variantBTemplateId;
  return templateId;
}

/**
 * The thresholds, in ONE place. The send loop imports these instead of redeclaring literals, and
 * a status view publishes them to the admin console so the UI can never drift from what the
 * engine actually enforces (the console used to hardcode its own numbers).
 */
export const BREAKER_DEFAULTS = Object.freeze({
  warnMin: 100,   // warn tier arms only after this many in-window sends
  warnPct: 0.02,  // >=2% hard-bounced => alert, send CONTINUES
  stopMin: 250,   // STOP tier arms only after a meaningful denominator
  stopPct: 0.05,  // >=5% hard-bounced => the campaign pauses ITSELF
});

/**
 * Pure verdict over one drain window. No I/O, no clock, no randomness: same inputs, same answer,
 * always (the send loop replays this every chunk).
 *
 * @param {object}  a
 * @param {number}  a.sentInWindow  sends in THIS drain session (the denominator)
 * @param {number}  a.hardBounced   hard-or-unknown bounces OF THOSE SENDS (the numerator)
 * @param {number} [a.warnMin] [a.warnPct] [a.stopMin] [a.stopPct]  overrides for tests
 * @returns {{tier:'none'|'warn'|'stop', rate:number, sentInWindow:number, hardBounced:number, armed:boolean}}
 *   `rate` is a fraction (0.02 = 2%), 0 when there is nothing to divide.
 *   `armed` is true once the window is big enough for the warn tier to mean anything.
 */
export function breakerVerdict({
  sentInWindow = 0,
  hardBounced = 0,
  warnMin = BREAKER_DEFAULTS.warnMin,
  warnPct = BREAKER_DEFAULTS.warnPct,
  stopMin = BREAKER_DEFAULTS.stopMin,
  stopPct = BREAKER_DEFAULTS.stopPct,
} = {}) {
  const sent = Number(sentInWindow) || 0;
  const hard = Number(hardBounced) || 0;
  // Never divide by zero and never let a NaN become a verdict: no denominator = no evidence.
  const rate = sent > 0 ? hard / sent : 0;
  const armed = sent >= warnMin;

  // Below warnMin the breaker says nothing at all. This mirrors the drain loop's own guard,
  // which skips the (expensive) bounce lookup entirely until the window is worth measuring.
  if (!armed) return { tier: 'none', rate, sentInWindow: sent, hardBounced: hard, armed };

  // STOP first: it is the strictly stronger verdict, and it needs BOTH the bigger denominator
  // and the higher rate. Boundaries are inclusive (>=) on purpose: exactly 5% is list rot.
  if (sent >= stopMin && rate >= stopPct) {
    return { tier: 'stop', rate, sentInWindow: sent, hardBounced: hard, armed };
  }
  if (rate >= warnPct) {
    return { tier: 'warn', rate, sentInWindow: sent, hardBounced: hard, armed };
  }
  return { tier: 'none', rate, sentInWindow: sent, hardBounced: hard, armed };
}
