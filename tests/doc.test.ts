import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildReviewRequests,
  formatHeading,
  chooseDocumentSource,
  documentUrl,
} from "../src/store/doc.ts";
import { imageUrlCandidates } from "../src/store/drive.ts";
import type { NormalizedReview } from "../src/normalize.ts";

function review(partial: Partial<NormalizedReview> = {}): NormalizedReview {
  return {
    source: "google",
    reviewId: "google:abc",
    author: "Sam K.",
    rating: 5,
    reviewDate: "2026-07-28",
    text: "Great food.",
    url: "https://maps.google.com/x",
    truncated: false,
    ...partial,
  };
}

const textOf = (requests: ReturnType<typeof buildReviewRequests>) =>
  requests
    .map((r) => (r["insertText"] as { text?: string } | undefined)?.text ?? "")
    .join("");

describe("formatHeading", () => {
  test("renders filled and empty stars to five", () => {
    assert.equal(
      formatHeading(review({ rating: 3 })),
      "Sam K. — ★★★☆☆ — Google Maps — 2026-07-28",
    );
  });

  test("labels the source readably rather than by internal key", () => {
    assert.match(formatHeading(review({ source: "yelp" })), /Yelp/);
    assert.doesNotMatch(formatHeading(review({ source: "yelp" })), /yelp —/);
  });
});

describe("buildReviewRequests", () => {
  test("includes author, review text, and link", () => {
    const out = textOf(buildReviewRequests(review(), null));
    assert.match(out, /Sam K\./);
    assert.match(out, /Great food\./);
    assert.match(out, /maps\.google\.com/);
  });

  test("emits no image request when there is no screenshot", () => {
    const requests = buildReviewRequests(review(), null);
    assert.equal(requests.filter((r) => "insertInlineImage" in r).length, 0);
  });

  test("embeds the image when a hosted url is supplied", () => {
    const requests = buildReviewRequests(
      review(),
      "https://lh3.googleusercontent.com/d/ID",
    );
    const image = requests.find((r) => "insertInlineImage" in r) as
      { insertInlineImage: { uri: string; objectSize: unknown } } | undefined;
    assert.ok(image, "expected an insertInlineImage request");
    assert.equal(
      image!.insertInlineImage.uri,
      "https://lh3.googleusercontent.com/d/ID",
    );
    assert.ok(image!.insertInlineImage.objectSize, "width must be constrained");
  });

  test("the image follows the review text, not the other way round", () => {
    const requests = buildReviewRequests(review(), "https://example.com/i.png");
    const imageAt = requests.findIndex((r) => "insertInlineImage" in r);
    const textAt = requests.findIndex((r) =>
      ((r["insertText"] as { text?: string } | undefined)?.text ?? "").includes(
        "Great food",
      ),
    );
    assert.ok(textAt < imageAt, "review text should precede its screenshot");
  });

  // A rating-only review is normal on Google. Emitting nothing would leave a
  // heading floating above a separator with no body.
  test("substitutes a placeholder for a rating-only review", () => {
    assert.match(
      textOf(buildReviewRequests(review({ text: "" }), null)),
      /rating only/,
    );
  });

  test("every insert appends to the end of the body", () => {
    // Index-based inserts shift every later index and corrupt the document;
    // endOfSegmentLocation sidesteps the arithmetic entirely.
    for (const request of buildReviewRequests(review(), "https://example.com/i.png")) {
      const payload = (request["insertText"] ?? request["insertInlineImage"]) as
        Record<string, unknown> | undefined;
      assert.ok(payload && "endOfSegmentLocation" in payload);
      assert.ok(payload && !("location" in payload));
    }
  });

  test("ends with a separator so entries do not run together", () => {
    assert.match(textOf(buildReviewRequests(review(), null)), /─+\n\n$/);
  });
});

describe("imageUrlCandidates", () => {
  test("offers more than one host, since Google has changed which one works", () => {
    const urls = imageUrlCandidates("FILE123");
    assert.ok(urls.length >= 2);
    assert.ok(urls.every((u) => u.includes("FILE123")));
  });
});

describe("chooseDocumentSource", () => {
  test("an explicit GOOGLE_DOC_ID wins over stored state", () => {
    assert.deepEqual(chooseDocumentSource("ENV_ID", "STORED_ID"), {
      kind: "env",
      id: "ENV_ID",
    });
  });

  test("falls back to the doc this app previously created", () => {
    assert.deepEqual(chooseDocumentSource(undefined, "STORED_ID"), {
      kind: "stored",
      id: "STORED_ID",
    });
  });

  test("asks for creation only when neither exists", () => {
    assert.deepEqual(chooseDocumentSource(undefined, undefined), { kind: "create" });
  });

  // An empty env var must not be mistaken for an id, or the run would target
  // document "" and fail confusingly instead of creating one.
  test("treats an empty env value as absent", () => {
    assert.deepEqual(chooseDocumentSource("", "STORED_ID"), {
      kind: "stored",
      id: "STORED_ID",
    });
  });
});

describe("documentUrl", () => {
  test("builds a URL that opens the doc", () => {
    assert.equal(
      documentUrl("ABC123"),
      "https://docs.google.com/document/d/ABC123/edit",
    );
  });
});
