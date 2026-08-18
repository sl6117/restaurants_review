import type { ArchivedReview } from "./archive.ts";
import { extractJson, HAIKU_MODEL, type Complete } from "./client.ts";

/** One reviewer statement, tagged with the review it came from — in code, so
 * the model cannot mis-attribute it. */
export interface ExtractedClaim {
  reviewId: string;
  sentiment: "pro" | "con";
  text: string;
}

const SYSTEM = `You extract claims from one restaurant review.
A claim is a single concrete statement about the restaurant (food, service, price, atmosphere, wait times, specific menu items).
Classify each claim as "pro" (favourable) or "con" (unfavourable). Skip statements about the reviewer themselves.
Reply with ONLY a JSON object: {"claims":[{"sentiment":"pro"|"con","text":"..."}]}
If the review supports no claims, reply {"claims":[]}.`;

export function buildExtractPrompt(review: ArchivedReview): string {
  return `Rating: ${review.rating}/5\nReview:\n${review.text}`;
}

export function parseExtractResponse(
  reply: string,
  reviewId: string,
): ExtractedClaim[] {
  const parsed = extractJson(reply) as { claims?: unknown };
  if (!Array.isArray(parsed.claims)) {
    throw new Error(`Extract reply for ${reviewId} has no "claims" array`);
  }
  const claims: ExtractedClaim[] = [];
  for (const entry of parsed.claims) {
    const c = entry as { sentiment?: unknown; text?: unknown };
    if (
      (c.sentiment === "pro" || c.sentiment === "con") &&
      typeof c.text === "string" &&
      c.text.trim() !== ""
    ) {
      claims.push({ reviewId, sentiment: c.sentiment, text: c.text.trim() });
    }
  }
  return claims;
}

export async function extractClaims(
  complete: Complete,
  review: ArchivedReview,
): Promise<ExtractedClaim[]> {
  const reply = await complete({
    model: HAIKU_MODEL,
    system: SYSTEM,
    user: buildExtractPrompt(review),
    temperature: 0,
    maxTokens: 1024,
  });
  return parseExtractResponse(reply, review.reviewId);
}
