import type { ArchivedReview } from "./archive.ts";

/** Mean star rating, rounded to two decimals for display. */
export function meanRating(reviews: ArchivedReview[]): number {
  if (reviews.length === 0) {
    throw new Error("Cannot average zero reviews");
  }
  const sum = reviews.reduce((total, review) => total + review.rating, 0);
  return sum / reviews.length;
}

/**
 * Computed in code, never by the LLM. `lastMonth` is null on a restaurant's
 * first month (or when the prior month has no archived reviews), in which case
 * only this month's rating is shown.
 */
export function formatTrajectory(thisMonth: number, lastMonth: number | null): string {
  const current = `Ratings this month was ${thisMonth.toFixed(2)}.`;
  if (lastMonth === null) return current;
  return `${current} Ratings last month was ${lastMonth.toFixed(2)}`;
}
