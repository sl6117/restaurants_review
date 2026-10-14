/**
 * Health check only — NOT a detector. See CLAUDE.md.
 *
 * Places API (New) returns 5 relevance-ranked reviews with no sort control, so
 * it cannot reliably surface the newest one. What it CAN do is answer "does
 * this place have reviews at all?", which distinguishes a genuinely quiet week
 * from a scraper that broke and is returning nothing.
 */

import type { HttpFetch } from "../resolve/types.ts";

export interface PlacesHealth {
  reachable: boolean;
  totalRatingCount: number | null;
  detail: string;
}

export async function checkPlacesHealth(
  apiKey: string,
  placeId: string,
  fetchFn: HttpFetch = fetch,
): Promise<PlacesHealth> {
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;
  try {
    const response = await fetchFn(url, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "id,displayName,rating,userRatingCount",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      // Never echo the response body — it can contain the key in error paths.
      return {
        reachable: false,
        totalRatingCount: null,
        detail: `Places API HTTP ${response.status}`,
      };
    }

    const body = (await response.json()) as { userRatingCount?: number };
    return {
      reachable: true,
      totalRatingCount: body.userRatingCount ?? 0,
      detail: `Places API reports ${body.userRatingCount ?? 0} ratings`,
    };
  } catch (error) {
    return {
      reachable: false,
      totalRatingCount: null,
      detail: `Places API unreachable: ${(error as Error).message}`,
    };
  }
}

/**
 * The check that matters: a scraper returning zero while the listing demonstrably
 * has reviews means the scraper is broken, not that the week was quiet.
 */
export function isScraperSilentlyBroken(
  scrapedCount: number,
  health: PlacesHealth,
): boolean {
  if (scrapedCount > 0) return false;
  if (!health.reachable || health.totalRatingCount === null) return false;
  return health.totalRatingCount > 0;
}
