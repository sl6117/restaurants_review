import type { ArchivedReview } from "./archive.ts";
import { extractJson, SONNET_MODEL, type Complete } from "./client.ts";
import type { Synthesis, SynthesizedClaim } from "./synthesize.ts";

const SYSTEM = `You are a strict judge. Given one claim about a restaurant and the full text of the reviews it cites, decide whether those reviews actually support the claim.
The claim is supported only if the cited reviews state it or clearly imply it. Reply with ONLY a JSON object: {"supported":true} or {"supported":false}.`;

export function buildJudgePrompt(
  claim: SynthesizedClaim,
  citedReviews: ArchivedReview[],
): string {
  const reviews = citedReviews
    .map((review) => `[${review.reviewId}] (${review.rating}/5) ${review.text}`)
    .join("\n\n");
  return `Claim: ${claim.text}\n\nCited reviews:\n${reviews}`;
}

export function parseJudgeResponse(reply: string): boolean {
  const parsed = extractJson(reply) as { supported?: unknown };
  if (typeof parsed.supported !== "boolean") {
    throw new Error(`Judge reply has no boolean "supported" field`);
  }
  return parsed.supported;
}

async function judgeClaim(
  complete: Complete,
  claim: SynthesizedClaim,
  reviewsById: Map<string, ArchivedReview>,
): Promise<boolean> {
  const cited = claim.citations
    .map((id) => reviewsById.get(id))
    .filter((review): review is ArchivedReview => review !== undefined);
  if (cited.length === 0) return false;
  const reply = await complete({
    model: SONNET_MODEL,
    system: SYSTEM,
    user: buildJudgePrompt(claim, cited),
    temperature: 0,
    maxTokens: 256,
  });
  return parseJudgeResponse(reply);
}

/** Re-checks every synthesized claim against its cited reviews; keeps only
 * claims the temperature-0 pass confirms. */
export async function judgeSynthesis(
  complete: Complete,
  synthesis: Synthesis,
  reviewsById: Map<string, ArchivedReview>,
): Promise<Synthesis> {
  const keep = async (claims: SynthesizedClaim[]) => {
    const kept: SynthesizedClaim[] = [];
    for (const claim of claims) {
      if (await judgeClaim(complete, claim, reviewsById)) kept.push(claim);
    }
    return kept;
  };
  return { pros: await keep(synthesis.pros), cons: await keep(synthesis.cons) };
}
