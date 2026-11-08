/**
 * Resend bounce classification: the single reader of a bounce payload.
 *
 * WHY THIS EXISTS (2026-07-20): Resend nests bounce detail under `data.bounce`
 * ({type, subType, message}). The webhook server read the flat
 * `data.bounce_type`, which does not exist in the payload, so:
 *
 *   - `bounceType` was ALWAYS '' -> `=== 'hard'` never matched
 *   - EVERY bounce fell through to the soft-bounce counter
 *   - the hard-bounce auto-suppress NEVER FIRED ONCE
 *
 * Measured on one newsletter issue: every bounced address was still sendable,
 * and the suppression table held over 100 hard-bounce rows written by the
 * previous email provider (it suppressed for us while we were on it) against
 * ZERO hard-bounce rows of our own. Dead addresses never left the list, so every
 * wave re-sent to them, they re-bounced, and the campaign circuit breaker
 * re-tripped every single morning.
 *
 * Both the webhook (suppression) and the send loop (circuit breaker) classify
 * through here so the two can never drift apart again.
 */

/** Resend `bounce.type` wire values. */
export const BOUNCE_PERMANENT = 'permanent';
export const BOUNCE_TRANSIENT = 'transient';
export const BOUNCE_UNDETERMINED = 'undetermined';

/**
 * Read a Resend `email.bounced` payload's `data` object into a flat verdict.
 * Falls back to the legacy flat fields so an upstream shape change degrades to
 * soft-bounce counting rather than silently dropping the signal.
 *
 * @param {object} data - the `data` object from the Resend webhook event
 * @returns {{type: string, subType: string, message: string|null, isHard: boolean}}
 */
export function readBounce(data = {}) {
  const b = data.bounce || {};
  const type = String(b.type ?? data.bounce_type ?? '').toLowerCase();
  const subType = String(b.subType ?? b.sub_type ?? '').toLowerCase();
  return {
    type,
    subType,
    message: b.message ?? data.bounce_message ?? null,
    // 'hard' / 'permanent_fail' are not Resend wire values; kept so any historical
    // or hand-written payload still classifies correctly.
    isHard: type === BOUNCE_PERMANENT || type === 'hard' || type === 'permanent_fail',
  };
}

/**
 * Is a stored bounce type (for example an events table's `bounce_type` column) a hard
 * (permanent) bounce?
 *
 * NOTE ON NULLs: every row written before 2026-07-20 has bounce_type = NULL because
 * of the bug above. `null` is therefore UNKNOWN, not "soft": callers that gate on
 * list quality must decide explicitly how to treat unknowns rather than defaulting
 * them to harmless. The circuit breaker counts them (a bounce we cannot classify is
 * still a bounce), while the suppressor does not act on them without a verdict.
 */
export function isHardBounceType(storedType) {
  if (storedType == null) return null; // unknown: caller decides
  const t = String(storedType).toLowerCase();
  return t === BOUNCE_PERMANENT || t === 'hard' || t === 'permanent_fail';
}
