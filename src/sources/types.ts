/** Shape extracted from the page DOM, before any interpretation. */
export interface RawReview {
  /** The site's own review id when the DOM exposes one. */
  domId: string | null;
  author: string;
  /** Raw rating string, e.g. "5 stars" / "5 star rating". */
  ratingLabel: string;
  /** Google: relative ("2 weeks ago"). Yelp: absolute ("Jul 28, 2026"). */
  dateLabel: string;
  text: string;
  /** Permalink when the DOM exposes one. */
  url: string | null;
}

/**
 * Ratings appear only inside aria-labels, whose wording differs per site and
 * changes with locale. Pulling the leading number is the stable part.
 */
export function parseRatingLabel(label: string): number {
  const match = /(\d+(?:\.\d+)?)/.exec(label);
  const value = match ? Number.parseFloat(match[1]!) : NaN;
  if (!Number.isFinite(value) || value < 1 || value > 5) {
    throw new Error(`Unparseable rating: "${label}"`);
  }
  return Math.round(value);
}

export class SourceBlockedError extends Error {
  constructor(source: string, detail: string) {
    super(
      `${source} blocked the request (${detail}). Do NOT add stealth plugins, ` +
        `proxies, or CAPTCHA solvers — report this to project owner instead.`,
    );
    this.name = "SourceBlockedError";
  }
}
