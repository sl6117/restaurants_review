import type { HttpFetch, ParsedInput } from "./types.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

/**
 * The model only splits words it was given into {name, location}. It is never
 * asked for — and its output is never used as — a URL or an ID; those come
 * exclusively from the Places / Fusion responses.
 */
const SYSTEM = [
  "Split the user's free-text restaurant query into a restaurant name and a location.",
  'Reply with ONLY a JSON object: {"name": "...", "location": "..."}.',
  "Copy words from the query; do not correct, expand, or invent anything.",
  "Use an empty string for location when the query names none.",
].join(" ");

export async function parseRestaurantInput(
  input: string,
  apiKey: string,
  fetchFn: HttpFetch = fetch,
): Promise<ParsedInput> {
  const response = await fetchFn(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      system: SYSTEM,
      messages: [{ role: "user", content: input }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    // Never echo the response body — same rule as every other API caller here.
    throw new Error(`Anthropic API HTTP ${response.status}`);
  }
  return extractParsedInput(await response.json());
}

/**
 * Pulls {name, location} out of a Messages API response body. Exported apart
 * from the fetch so tests can run it over a fixture with no network.
 */
export function extractParsedInput(body: unknown): ParsedInput {
  const content = (body as { content?: { type?: string; text?: string }[] }).content;
  const text = content?.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("Anthropic response contained no text block.");

  // Tolerate a model that wraps the JSON in a code fence despite instructions.
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error("Could not parse the model's reply as JSON.");
  }

  const record = parsed as Partial<ParsedInput>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const location = typeof record.location === "string" ? record.location.trim() : "";
  if (!name) throw new Error("The model's reply had no restaurant name.");
  return { name, location };
}
