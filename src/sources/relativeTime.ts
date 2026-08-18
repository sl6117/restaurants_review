/**
 * Google Maps renders review timestamps only as relative text ("2 weeks ago").
 * There is no absolute date in the DOM, so this is the only way to date a
 * scraped Google review.
 *
 * Accuracy is inherently limited — "3 months ago" could be any day in a ~30-day
 * window. That is tolerable because Google review IDs come from the DOM's
 * `data-review-id`, so dedupe never depends on this value. If you ever change
 * Google IDs to be date-derived, revisit that decision first.
 */

const UNIT_PATTERN =
  /^(?:edited\s+)?(?:(a|an|\d+)\s+)?(second|minute|hour|day|week|month|year)s?\s+ago$/i;

export function parseRelativeTime(input: string, now: Date): Date {
  const text = input.trim().toLowerCase().replace(/\s+/g, " ");

  if (text === "just now" || text === "a moment ago" || text === "moments ago") {
    return new Date(now);
  }
  if (text === "yesterday" || text === "edited yesterday") {
    return shiftDays(now, -1);
  }

  const match = UNIT_PATTERN.exec(text);
  if (!match) {
    throw new Error(`Unrecognized relative timestamp: "${input}"`);
  }

  const rawCount = match[1];
  const unit = match[2]!;
  // "a week ago" / "an hour ago" both mean one.
  const count =
    rawCount === undefined || rawCount === "a" || rawCount === "an"
      ? 1
      : Number.parseInt(rawCount, 10);

  if (!Number.isFinite(count) || count < 0) {
    throw new Error(`Unrecognized relative timestamp: "${input}"`);
  }

  switch (unit) {
    case "second":
      return new Date(now.getTime() - count * 1_000);
    case "minute":
      return new Date(now.getTime() - count * 60_000);
    case "hour":
      return new Date(now.getTime() - count * 3_600_000);
    case "day":
      return shiftDays(now, -count);
    case "week":
      return shiftDays(now, -count * 7);
    // Months and years use calendar arithmetic, not fixed 30/365-day spans, so
    // "6 months ago" lands on the same day-of-month rather than drifting.
    case "month":
      return shiftMonths(now, -count);
    case "year":
      return shiftMonths(now, -count * 12);
    default:
      throw new Error(`Unrecognized relative timestamp: "${input}"`);
  }
}

/** Convenience wrapper returning the UTC calendar day. */
export function parseRelativeTimeToDay(input: string, now: Date): string {
  return parseRelativeTime(input, now).toISOString().slice(0, 10);
}

function shiftDays(from: Date, days: number): Date {
  const out = new Date(from);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/**
 * Clamps to the last valid day of the target month, so shifting back one month
 * from March 31 gives February 28/29 rather than rolling into March.
 */
function shiftMonths(from: Date, months: number): Date {
  const out = new Date(from);
  const targetDay = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0),
  ).getUTCDate();
  out.setUTCDate(Math.min(targetDay, lastDay));
  return out;
}
