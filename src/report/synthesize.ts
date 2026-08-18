import { extractJson, SONNET_MODEL, type Complete } from "./client.ts";
import type { ExtractedClaim } from "./extract.ts";

export interface SynthesizedClaim {
  text: string;
  /** Review IDs this claim rests on. Uncited or unknown-ID claims are dropped. */
  citations: string[];
}

export interface Synthesis {
  pros: SynthesizedClaim[];
  cons: SynthesizedClaim[];
}

const SYSTEM = `You synthesize a month of restaurant review claims into a pros/cons report.
Merge claims that say the same thing; keep distinct points separate. Write each pro or con as one short sentence.
Every pro/con MUST cite the review IDs of the claims it came from, copied verbatim. Never invent an ID; never leave citations empty.
Reply with ONLY a JSON object:
{"pros":[{"text":"...","citations":["<reviewId>"]}],"cons":[{"text":"...","citations":["<reviewId>"]}]}`;

export function buildSynthesisPrompt(
  restaurantName: string,
  claims: ExtractedClaim[],
): string {
  const lines = claims.map((claim) => JSON.stringify(claim));
  return `Restaurant: ${restaurantName}\nClaims (one JSON object per line):\n${lines.join("\n")}`;
}

export function parseSynthesisResponse(reply: string): Synthesis {
  const parsed = extractJson(reply) as { pros?: unknown; cons?: unknown };
  return {
    pros: parseClaimList(parsed.pros, "pros"),
    cons: parseClaimList(parsed.cons, "cons"),
  };
}

function parseClaimList(value: unknown, label: string): SynthesizedClaim[] {
  if (!Array.isArray(value)) {
    throw new Error(`Synthesis reply has no "${label}" array`);
  }
  const claims: SynthesizedClaim[] = [];
  for (const entry of value) {
    const c = entry as { text?: unknown; citations?: unknown };
    if (typeof c.text !== "string" || c.text.trim() === "") continue;
    const citations = Array.isArray(c.citations)
      ? c.citations.filter((id): id is string => typeof id === "string")
      : [];
    claims.push({ text: c.text.trim(), citations });
  }
  return claims;
}

/**
 * Enforces the citation rule in code: citations pointing at IDs that are not
 * in this month's review set are hallucinations and are removed; a claim with
 * no surviving citation is dropped entirely.
 */
export function dropUncited(synthesis: Synthesis, knownIds: Set<string>): Synthesis {
  const clean = (claims: SynthesizedClaim[]) =>
    claims
      .map((claim) => ({
        text: claim.text,
        citations: claim.citations.filter((id) => knownIds.has(id)),
      }))
      .filter((claim) => claim.citations.length > 0);
  return { pros: clean(synthesis.pros), cons: clean(synthesis.cons) };
}

export async function synthesize(
  complete: Complete,
  restaurantName: string,
  claims: ExtractedClaim[],
): Promise<Synthesis> {
  const reply = await complete({
    model: SONNET_MODEL,
    system: SYSTEM,
    user: buildSynthesisPrompt(restaurantName, claims),
    temperature: 0.2,
    maxTokens: 2048,
  });
  return parseSynthesisResponse(reply);
}
