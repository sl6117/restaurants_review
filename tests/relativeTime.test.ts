import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseRelativeTime,
  parseRelativeTimeToDay,
} from "../src/sources/relativeTime.ts";

// Fixed clock: a Friday, mid-month, so month/year shifts are unambiguous.
const NOW = new Date("2026-07-30T12:00:00.000Z");
const day = (input: string) => parseRelativeTimeToDay(input, NOW);

describe("parseRelativeTime", () => {
  test("handles the immediate cases", () => {
    assert.equal(day("just now"), "2026-07-30");
    assert.equal(day("a moment ago"), "2026-07-30");
    assert.equal(day("yesterday"), "2026-07-29");
  });

  test("treats 'a' and 'an' as one", () => {
    assert.equal(day("a day ago"), "2026-07-29");
    assert.equal(day("an hour ago"), "2026-07-30");
    assert.equal(day("a week ago"), "2026-07-23");
  });

  test("handles plural counts", () => {
    assert.equal(day("2 days ago"), "2026-07-28");
    assert.equal(day("3 weeks ago"), "2026-07-09");
    assert.equal(day("45 minutes ago"), "2026-07-30");
  });

  test("uses calendar arithmetic for months and years", () => {
    assert.equal(day("1 month ago"), "2026-06-30");
    assert.equal(day("6 months ago"), "2026-01-30");
    assert.equal(day("a year ago"), "2025-07-30");
    assert.equal(day("2 years ago"), "2024-07-30");
  });

  test("strips Google's 'Edited' prefix", () => {
    assert.equal(day("Edited 2 days ago"), "2026-07-28");
    assert.equal(day("edited yesterday"), "2026-07-29");
  });

  test("is case and whitespace insensitive", () => {
    assert.equal(day("  3   DAYS   AGO "), "2026-07-27");
  });

  // Month-end clamping: naive 30-day subtraction gets these wrong.
  test("clamps when the target month is shorter", () => {
    const march31 = new Date("2026-03-31T12:00:00.000Z");
    assert.equal(parseRelativeTimeToDay("a month ago", march31), "2026-02-28");
  });

  test("clamps into a leap February", () => {
    const march31 = new Date("2024-03-31T12:00:00.000Z");
    assert.equal(parseRelativeTimeToDay("a month ago", march31), "2024-02-29");
  });

  test("crosses a year boundary correctly", () => {
    const jan = new Date("2026-01-15T12:00:00.000Z");
    assert.equal(parseRelativeTimeToDay("2 months ago", jan), "2025-11-15");
  });

  // Throwing beats silently returning Invalid Date or today's date — a wrong
  // date that looks plausible is worse than a loud failure.
  test("throws on unrecognized input rather than guessing", () => {
    assert.throws(() => parseRelativeTime("a while back", NOW), /Unrecognized/);
    assert.throws(() => parseRelativeTime("", NOW), /Unrecognized/);
    assert.throws(() => parseRelativeTime("in 2 days", NOW), /Unrecognized/);
  });

  test("returns an instant, not just a day, for sub-day units", () => {
    const result = parseRelativeTime("2 hours ago", NOW);
    assert.equal(result.toISOString(), "2026-07-30T10:00:00.000Z");
  });

  test("never returns a future date", () => {
    for (const input of ["just now", "a day ago", "5 weeks ago", "3 years ago"]) {
      assert.ok(
        parseRelativeTime(input, NOW).getTime() <= NOW.getTime(),
        `${input} produced a future date`,
      );
    }
  });
});
