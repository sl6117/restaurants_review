import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  googleReviewId,
  yelpReviewId,
  slugifyAuthor,
  toIsoDay,
  resolveIdCollisions,
  type NormalizedReview,
  slugifyRestaurantName,
} from "../src/normalize.ts";

function review(partial: Partial<NormalizedReview>): NormalizedReview {
  return {
    source: "yelp",
    reviewId: "yelp:sam-k:2026-07-28",
    author: "Sam K.",
    rating: 5,
    reviewDate: "2026-07-28",
    text: "Great food.",
    url: "https://yelp.com/biz/example",
    truncated: false,
    ...partial,
  };
}

describe("googleReviewId", () => {
  test("takes the trailing segment of the resource name", () => {
    assert.equal(
      googleReviewId("places/ChIJabc123/reviews/ChdDSUhNMG9nS0VJQ0FnSUR"),
      "google:ChdDSUhNMG9nS0VJQ0FnSUR",
    );
  });

  test("is stable when the place prefix changes", () => {
    const a = googleReviewId("places/PLACE_A/reviews/REV1");
    const b = googleReviewId("places/PLACE_B/reviews/REV1");
    assert.equal(a, b);
  });

  test("rejects an empty resource name rather than yielding a blank id", () => {
    assert.throws(() => googleReviewId(""), /Unusable Google review name/);
  });
});

describe("yelpReviewId", () => {
  test("ignores review text so an edited review is not resurfaced", () => {
    const before = yelpReviewId("Sam K.", "2026-07-28");
    const after = yelpReviewId("Sam K.", "2026-07-28");
    assert.equal(before, after);
    assert.equal(before, "yelp:sam-k:2026-07-28");
  });

  test("narrows a full timestamp to its day", () => {
    assert.equal(
      yelpReviewId("Sam K.", "2026-07-28T19:04:00Z"),
      yelpReviewId("Sam K.", "2026-07-28"),
    );
  });

  test("distinguishes different authors on the same day", () => {
    assert.notEqual(
      yelpReviewId("Sam K.", "2026-07-28"),
      yelpReviewId("Sam L.", "2026-07-28"),
    );
  });
});

describe("slugifyAuthor", () => {
  test("strips accents rather than dropping the character", () => {
    assert.equal(slugifyAuthor("José M."), "jose-m");
  });

  test("never returns an empty slug", () => {
    const slug = slugifyAuthor("하하");
    assert.notEqual(slug, "");
    assert.equal(slug, slugifyAuthor("하하"));
  });

  test("collapses punctuation runs and trims edges", () => {
    assert.equal(slugifyAuthor("  A. B.  C!! "), "a-b-c");
  });

  test("falls back to a hash for an all-punctuation name", () => {
    const slug = slugifyAuthor("!!!");
    assert.notEqual(slug, "");
    assert.match(slug, /^x[0-9a-f]{8}$/);
    assert.equal(slug, slugifyAuthor("!!!"));
  });

  test("distinct all-punctuation names do not collapse to one slug", () => {
    assert.notEqual(slugifyAuthor("!!!"), slugifyAuthor("***@#$"));
  });
});

describe("slugifyRestaurantName", () => {
  test("collapses punctuation runs and trims edges", () => {
    assert.equal(slugifyRestaurantName("Dr. DOOOM Lab"),"dr-dooom-lab");
  });
  test("to lowercase", () => {
    assert.equal(slugifyRestaurantName("KFC"),"kfc");
  });
  // punctuation/non-latin input produces a nonempty slug
  test("non-latin input produces a nonempty slug", () => {
    const slug = slugifyRestaurantName("싱하형");
    assert.match(slug, /^restaurant-[0-9a-f]{8}$/);
  });
  test("equivalent formatting produces the same slug", () => {
    assert.equal(slugifyRestaurantName("Dr. DOOOM Lab"),slugifyRestaurantName("Dr. DOOOM Lab."));
  });
  assert.equal(
    `${slugifyRestaurantName("Dr. DOOOM Lab")}:yelp:reviewer:2026-08-16`,
    "dr-dooom-lab:yelp:reviewer:2026-08-16",
  );
});

describe("toIsoDay", () => {
  test("rejects unparseable input instead of emitting Invalid Date", () => {
    assert.throws(() => toIsoDay("a while ago"), /Unparseable review date/);
  });
});

describe("resolveIdCollisions", () => {
  test("leaves non-colliding ids untouched", () => {
    const input = [
      review({ reviewId: "yelp:sam-k:2026-07-28" }),
      review({ reviewId: "yelp:jo-b:2026-07-28", author: "Jo B." }),
    ];
    const out = resolveIdCollisions(input);
    assert.deepEqual(
      out.map((r) => r.reviewId),
      ["yelp:sam-k:2026-07-28", "yelp:jo-b:2026-07-28"],
    );
  });

  test("disambiguates two reviews sharing an id", () => {
    const out = resolveIdCollisions([
      review({ text: "First visit, loved it." }),
      review({ text: "Came back for dinner." }),
    ]);
    assert.equal(new Set(out.map((r) => r.reviewId)).size, 2);
  });

  // The regression that matters: if disambiguation were positional, a source
  // reordering its response would swap the ids and re-append a seen review.
  test("assigns the same ids regardless of input order", () => {
    const a = review({ text: "First visit, loved it." });
    const b = review({ text: "Came back for dinner." });

    const forward = resolveIdCollisions([a, b]);
    const backward = resolveIdCollisions([b, a]);

    const idOf = (batch: NormalizedReview[], text: string) =>
      batch.find((r) => r.text === text)!.reviewId;

    assert.equal(idOf(forward, a.text), idOf(backward, a.text));
    assert.equal(idOf(forward, b.text), idOf(backward, b.text));
  });

  test("preserves input ordering of the returned array", () => {
    const out = resolveIdCollisions([review({ text: "zzz" }), review({ text: "aaa" })]);
    assert.deepEqual(
      out.map((r) => r.text),
      ["zzz", "aaa"],
    );
  });

  test("keeps the bare id in use so the no-collision case stays byte-identical", () => {
    const out = resolveIdCollisions([review({ text: "one" }), review({ text: "two" })]);
    assert.ok(out.some((r) => r.reviewId === "yelp:sam-k:2026-07-28"));
  });
});
