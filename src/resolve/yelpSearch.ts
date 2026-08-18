import type { HttpFetch, YelpResolution } from "./types.ts";

const SEARCH_URL = "https://api.yelp.com/v3/businesses/search";
const EMPTY: YelpResolution = { businessUrl: "", name: "" };

/**
 * Resolves name + location to a Yelp business URL via Fusion business search.
 * No scraping (spec non-goal). Failures return empty strings, never throw.
 */
export async function searchYelpBusiness(
  name: string,
  location: string,
  apiKey: string,
  fetchFn: HttpFetch = fetch,
): Promise<YelpResolution> {
  // Fusion's /businesses/search requires a location; without one the call can
  // only 400, so skip the doomed request.
  if (!location.trim()) {
    console.warn("  ! Yelp search needs a location; treating Yelp as unresolved.");
    return { ...EMPTY };
  }
  const url = `${SEARCH_URL}?${new URLSearchParams({ term: name, location, limit: "5" })}`;
  try {
    const response = await fetchFn(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.warn(`  ! Yelp Fusion HTTP ${response.status}; treating Yelp as unresolved.`);
      return { ...EMPTY };
    }
    return extractYelpResolution(await response.json());
  } catch (error) {
    console.warn(`  ! Yelp Fusion unreachable: ${(error as Error).message}`);
    return { ...EMPTY };
  }
}

/** Results are relevance-ranked; the spec says take the top one. */
export function extractYelpResolution(body: unknown): YelpResolution {
  const businesses = (body as { businesses?: { url?: string; name?: string }[] })
    .businesses;
  const top = businesses?.[0];
  if (!top?.url) return { ...EMPTY };
  return { businessUrl: canonicalizeYelpUrl(top.url), name: top.name ?? "" };
}

/**
 * Fusion appends per-app tracking params (adjust_creative, utm_*) to business
 * URLs. Strip query and hash so the stored URL matches hand-pasted ones and
 * the businessUrl dedupe key stays stable across API keys.
 */
export function canonicalizeYelpUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return raw;
  }
}
