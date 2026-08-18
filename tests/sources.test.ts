import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseRatingLabel } from "../src/sources/types.ts";
import { mapGoogleReviews, countMissingDomIds } from "../src/sources/googleMaps.ts";
import {
  parseYelpDate,
  mapYelpReviews,
  pickAuthor,
  pickReviewText,
  type YelpRawNode,
} from "../src/sources/yelp.ts";
import { isScraperSilentlyBroken } from "../src/sources/googlePlaces.ts";
import type { RawReview } from "../src/sources/types.ts";

const NOW = new Date("2026-07-30T12:00:00.000Z");

function rawGoogle(partial: Partial<RawReview> = {}): RawReview {
  return {
    domId: "places/CHIJ_abc/reviews/REVIEW_1",
    author: "Sam K.",
    ratingLabel: "5 stars",
    dateLabel: "2 days ago",
    text: "Great food.",
    url: "https://maps.google.com/x",
    ...partial,
  };
}

function rawYelp(partial: Partial<YelpRawNode> = {}): YelpRawNode {
  return {
    // Mirrors the real DOM: an empty avatar link, then the display-name link.
    authorCandidates: ["", "Sam K."],
    ratingLabel: "5 star rating",
    dateLabel: "Jul 28, 2026",
    commentCandidates: ["Great food."],
    url: null,
    ...partial,
  };
}

describe("parseRatingLabel", () => {
  test("reads the leading number out of either site's aria-label wording", () => {
    assert.equal(parseRatingLabel("5 stars"), 5);
    assert.equal(parseRatingLabel("4 star rating"), 4);
    assert.equal(parseRatingLabel("1 star"), 1);
    assert.equal(parseRatingLabel("Rated 3.0 out of 5"), 3);
  });

  test("rejects out-of-range and unparseable labels rather than defaulting", () => {
    assert.throws(() => parseRatingLabel(""), /Unparseable rating/);
    assert.throws(() => parseRatingLabel("no stars"), /Unparseable rating/);
    assert.throws(() => parseRatingLabel("0 stars"), /Unparseable rating/);
    assert.throws(() => parseRatingLabel("9 stars"), /Unparseable rating/);
  });
});

describe("mapGoogleReviews", () => {
  test("prefers Google's own review id", () => {
    const [review] = mapGoogleReviews([rawGoogle()], NOW);
    assert.equal(review!.reviewId, "google:REVIEW_1");
  });

  test("resolves the relative timestamp to a date", () => {
    const [review] = mapGoogleReviews([rawGoogle({ dateLabel: "2 days ago" })], NOW);
    assert.equal(review!.reviewDate, "2026-07-28");
  });

  // A missing id must still produce a row: a duplicate is recoverable, a
  // silently dropped review is not.
  test("falls back to an author/text id when the DOM has no review id", () => {
    const [review] = mapGoogleReviews([rawGoogle({ domId: null })], NOW);
    assert.match(review!.reviewId, /^google:fallback:sam-k:[0-9a-f]{8}$/);
  });

  test("the fallback id is stable across runs for identical input", () => {
    const a = mapGoogleReviews([rawGoogle({ domId: null })], NOW)[0]!.reviewId;
    const b = mapGoogleReviews([rawGoogle({ domId: null })], NOW)[0]!.reviewId;
    assert.equal(a, b);
  });

  test("counts missing ids so the run can warn about degraded dedupe", () => {
    assert.equal(countMissingDomIds([rawGoogle(), rawGoogle({ domId: null })]), 1);
  });

  test("never marks Google reviews as truncated", () => {
    assert.equal(mapGoogleReviews([rawGoogle()], NOW)[0]!.truncated, false);
  });
});

describe("parseYelpDate", () => {
  test("parses both renderings Yelp uses", () => {
    assert.equal(parseYelpDate("Jul 28, 2026"), "2026-07-28");
    assert.equal(parseYelpDate("July 28, 2026"), "2026-07-28");
    assert.equal(parseYelpDate("7/28/2026"), "2026-07-28");
  });

  test("is not tripped up by single-digit days or missing commas", () => {
    assert.equal(parseYelpDate("Jan 5 2026"), "2026-01-05");
    assert.equal(parseYelpDate("1/5/2026"), "2026-01-05");
  });

  // The date is half the Yelp dedupe key, so a wrong-but-plausible date would
  // corrupt dedupe silently. Throwing is the safe failure.
  test("throws rather than guessing", () => {
    assert.throws(() => parseYelpDate("2 days ago"), /Unparseable Yelp date/);
    assert.throws(() => parseYelpDate(""), /Unparseable Yelp date/);
  });

  test("rejects an impossible date instead of rolling it forward", () => {
    assert.throws(() => parseYelpDate("2/30/2026"), /Impossible Yelp date/);
    assert.throws(() => parseYelpDate("Feb 30, 2026"), /Impossible Yelp date/);
  });
});

// Regression: the live page has an avatar link with no text before the display
// name. Taking the first match gave every reviewer the empty-string author,
// which made all same-day reviews collide on one id.
describe("pickAuthor", () => {
  test("skips the empty avatar link and takes the display name", () => {
    assert.equal(pickAuthor(["", "Julian .."]), "Julian ..");
  });

  test("handles whitespace-only candidates", () => {
    assert.equal(pickAuthor(["   ", "\n", "Sam K."]), "Sam K.");
  });

  test("throws rather than returning an empty author", () => {
    assert.throws(() => pickAuthor([]), /No Yelp author name found/);
    assert.throws(() => pickAuthor(["", "  "]), /No Yelp author name found/);
  });
});

// Regression: each review <li> also contains the owner's reply in a second
// comment paragraph. Joining them put the restaurant's own marketing copy into
// the review column.
describe("pickReviewText", () => {
  test("takes the reviewer's comment, not the owner's reply", () => {
    assert.equal(
      pickReviewText(["The service was great.", "Hi Julian, thank you so much!"]),
      "The service was great.",
    );
  });

  test("returns empty for a rating-only review instead of throwing", () => {
    assert.equal(pickReviewText([]), "");
  });
});

describe("mapYelpReviews", () => {
  test("derives an id from author and date", () => {
    const [review] = mapYelpReviews([rawYelp()], "https://yelp.com/biz/x");
    assert.equal(review!.reviewId, "yelp:sam-k:2026-07-28");
  });

  test("falls back to the business url when no permalink is exposed", () => {
    const [review] = mapYelpReviews([rawYelp({ url: null })], "https://yelp.com/biz/x");
    assert.equal(review!.url, "https://yelp.com/biz/x");
  });

  test("disambiguates one author reviewing twice on the same day", () => {
    const reviews = mapYelpReviews(
      [
        rawYelp({ commentCandidates: ["Lunch was great."] }),
        rawYelp({ commentCandidates: ["Dinner was better."] }),
      ],
      "https://yelp.com/biz/x",
    );
    assert.equal(new Set(reviews.map((r) => r.reviewId)).size, 2);
  });
});

describe("isScraperSilentlyBroken", () => {
  test("a scrape that found reviews is never broken", () => {
    assert.equal(
      isScraperSilentlyBroken(3, { reachable: true, totalRatingCount: 0, detail: "" }),
      false,
    );
  });

  test("empty scrape plus a listing that demonstrably has reviews means broken", () => {
    assert.equal(
      isScraperSilentlyBroken(0, { reachable: true, totalRatingCount: 42, detail: "" }),
      true,
    );
  });

  test("a genuinely review-less listing is not a broken scraper", () => {
    assert.equal(
      isScraperSilentlyBroken(0, { reachable: true, totalRatingCount: 0, detail: "" }),
      false,
    );
  });

  // An unreachable health check proves nothing, so it must not raise a false alarm.
  test("an unreachable API does not accuse the scraper", () => {
    assert.equal(
      isScraperSilentlyBroken(0, {
        reachable: false,
        totalRatingCount: null,
        detail: "",
      }),
      false,
    );
  });
});
