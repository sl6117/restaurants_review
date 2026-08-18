import type { ArchivedReview } from "./archive.ts";
import type { Complete } from "./client.ts";
import { extractClaims, type ExtractedClaim } from "./extract.ts";
import { judgeSynthesis } from "./judge.ts";
import { renderReport } from "./markdown.ts";
import { dropUncited, synthesize, type Synthesis } from "./synthesize.ts";
import { formatTrajectory, meanRating } from "./trajectory.ts";

export interface ReportInput {
  restaurantName: string;
  /** `YYYY-MM`. */
  month: string;
  /** This restaurant's reviews whose reviewDate falls in `month`. Non-empty. */
  reviews: ArchivedReview[];
  /** Same restaurant, previous calendar month. Empty on a first month. */
  priorMonthReviews: ArchivedReview[];
  complete: Complete;
}

/**
 * Map (Haiku: review -> claims) -> reduce (Sonnet: claims -> cited pros/cons)
 * -> judge (temperature 0: claim vs its cited reviews). The trajectory is
 * computed here in code, per spec.
 */
export async function buildReport(input: ReportInput): Promise<string> {
  const claims: ExtractedClaim[] = [];
  for (const review of input.reviews) {
    claims.push(...(await extractClaims(input.complete, review)));
  }

  let synthesis: Synthesis = { pros: [], cons: [] };
  if (claims.length > 0) {
    synthesis = await synthesize(input.complete, input.restaurantName, claims);
    const knownIds = new Set(input.reviews.map((review) => review.reviewId));
    synthesis = dropUncited(synthesis, knownIds);
    const reviewsById = new Map(
      input.reviews.map((review) => [review.reviewId, review]),
    );
    synthesis = await judgeSynthesis(input.complete, synthesis, reviewsById);
  }

  const trajectory = formatTrajectory(
    meanRating(input.reviews),
    input.priorMonthReviews.length > 0 ? meanRating(input.priorMonthReviews) : null,
  );

  return renderReport({
    restaurantName: input.restaurantName,
    month: input.month,
    synthesis,
    trajectory,
  });
}
