import { createHash } from "node:crypto";

export type ReviewSource = "google" | "yelp";

export interface NormalizedReview {
  source: ReviewSource;
  /** Stable across runs. See `resolveIdCollisions` for the Yelp caveat. */
  reviewId: string;
  author: string;
  /** 1-5. */
  rating: number;
  /** ISO-8601 UTC instant, or a YYYY-MM-DD day when that is all the source gives. */
  reviewDate: string;
  text: string;
  /** Permalink to the review, or to the listing when the source has no permalink. */
  url: string;
  /** True when `text` is an excerpt rather than the full review (Yelp Fusion). */
  truncated: boolean;
  /** Absolute path to a captured PNG. Absent when enrichment was blocked. */
  screenshotPath?: string;
}

/**
 * Google review resource names look like
 * `places/ChIJ.../reviews/ChdDSUhN...`. The final segment is stable, so it is
 * the ID; the prefix only repeats the place.
 */
export function googleReviewId(resourceName: string): string {
  const segments = resourceName.split("/").filter(Boolean);
  const last = segments.at(-1);
  if (!last) throw new Error(`Unusable Google review name: "${resourceName}"`);
  return `google:${last}`;
}

/**
 * Yelp exposes no stable review ID, so we derive one from author + review day.
 *
 * Review text is deliberately excluded: a reviewer editing their review must
 * not resurface it as new. The cost is that edits never update the sheet.
 */
export function yelpReviewId(author: string, reviewDate: string): string {
  return `yelp:${slugifyAuthor(author)}:${toIsoDay(reviewDate)}`;
}

export function slugifyAuthor(author: string): string {
  const slug = author
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining marks left by NFKD
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // A reviewer named only with non-Latin characters would otherwise slug to "".
  return slug || `x${shortHash(author)}`;
}

export function slugifyRestaurantName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining marks left by NFKD
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // A restaurant name made only with non-Latin characters would otherwise slug to "".
  return slug || `restaurant-${shortHash(name)}`;
}

/** Narrows any parseable date to its UTC calendar day. */
export function toIsoDay(input: string): string {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Unparseable review date: "${input}"`);
  }
  return parsed.toISOString().slice(0, 10);
}

export function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 8);
}

/**
 * Disambiguates reviews that derive the same ID — in practice, one author
 * reviewing the same business twice on one day.
 *
 * Ordering is decided by a hash of the text, NOT by the order the source
 * returned them. If it were positional, a source reordering its response would
 * swap the two IDs and make an already-seen review look new.
 *
 * The lowest-hashed review keeps the bare ID so that the common case (no
 * collision at all) stays byte-identical to `yelpReviewId`'s output.
 */
export function resolveIdCollisions(reviews: NormalizedReview[]): NormalizedReview[] {
  const byId = new Map<string, NormalizedReview[]>();
  for (const review of reviews) {
    const group = byId.get(review.reviewId);
    if (group) group.push(review);
    else byId.set(review.reviewId, [review]);
  }

  const resolved = new Map<NormalizedReview, string>();
  for (const [id, group] of byId) {
    if (group.length === 1) {
      resolved.set(group[0]!, id);
      continue;
    }
    const ranked = [...group].sort((a, b) =>
      shortHash(a.text).localeCompare(shortHash(b.text)),
    );
    ranked.forEach((review, index) => {
      resolved.set(review, index === 0 ? id : `${id}#${shortHash(review.text)}`);
    });
  }

  // Preserve the caller's ordering; only the IDs change.
  return reviews.map((review) => ({ ...review, reviewId: resolved.get(review)! }));
}
