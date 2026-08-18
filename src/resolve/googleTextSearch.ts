import type { GoogleResolution, HttpFetch } from "./types.ts";

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const EMPTY: GoogleResolution = { placeId: "", mapsUrl: "", displayName: "" };

/**
 * Resolves name + location to a real place via Places API (New) Text Search.
 *
 * Failures return empty strings (= "not resolved") instead of throwing: one
 * source failing must not stop the other from being used (spec rule).
 */
export async function searchGooglePlace(
  name: string,
  location: string,
  apiKey: string,
  fetchFn: HttpFetch = fetch,
): Promise<GoogleResolution> {
  const textQuery = [name, location].filter(Boolean).join(" ");
  try {
    const response = await fetchFn(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        // googleMapsUri is the only sanctioned origin of mapsUrl — never built by hand.
        "X-Goog-FieldMask": "places.id,places.displayName,places.googleMapsUri",
      },
      body: JSON.stringify({ textQuery, maxResultCount: 5 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      // Body not echoed: Google error payloads can include the key.
      console.warn(
        `  ! Places Text Search HTTP ${response.status}; treating Google as unresolved.`,
      );
      return { ...EMPTY };
    }
    return extractGoogleResolution(await response.json());
  } catch (error) {
    console.warn(`  ! Places Text Search unreachable: ${(error as Error).message}`);
    return { ...EMPTY };
  }
}

/**
 * Results are relevance-ranked; the spec says take the top one. A place is
 * only "resolved" with BOTH an id and a Maps URL — a half-resolved Google
 * entry could neither be scraped nor deduped consistently.
 */
export function extractGoogleResolution(body: unknown): GoogleResolution {
  const places = (
    body as {
      places?: { id?: string; googleMapsUri?: string; displayName?: { text?: string } }[];
    }
  ).places;
  const top = places?.[0];
  if (!top?.id || !top.googleMapsUri) return { ...EMPTY };
  return {
    placeId: top.id,
    mapsUrl: top.googleMapsUri,
    displayName: top.displayName?.text ?? "",
  };
}
