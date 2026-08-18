import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface Target {
  restaurantName: string;
  google: { mapsUrl: string; placeId?: string };
  yelp: { businessUrl: string };
}

export interface Env {
  googleMapsApiKey: string | null;
  documentId: string;
  oauthClientPath: string;
  oauthTokenPath: string;
}

export async function loadTargets(
  path = resolve(PROJECT_ROOT, "config/targets.json"),
): Promise<Target[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Missing ${path}. Copy config/targets.example.json to config/targets.json ` +
          `and paste in the Google Maps and Yelp URLs.`,
      );
    }
    throw error;
  }

  const parsed = JSON.parse(raw) as unknown;

  // The shape change is the likeliest misconfiguration. Name it exactly
  if (!Array.isArray(parsed)) {
    throw new Error(
      `config/targets.json must be an ARRAY of targets. Wrap the existing object in [ ].`,
    );
  }

  if (parsed.length === 0) {
    throw new Error(`config/targets.json has no targets. Add at least one.`);
  }
  return parsed.map((entry, index) => validateTarget(entry as Partial<Target>, index));
}

/**
 * GOOGLE_DOC_ID is optional and normally empty: under the `drive.file` scope the
 * app can only touch documents it created, so `resolveDocument()` creates one on
 * first run. Setting it is an override for pointing a run at a different doc.
 */
export function loadEnv(): Env {
  return {
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || null,
    documentId: process.env.GOOGLE_DOC_ID ?? "",
    oauthClientPath: resolve(
      PROJECT_ROOT,
      process.env.GOOGLE_OAUTH_CLIENT || "credentials/oauth-client.json",
    ),
    oauthTokenPath: resolve(
      PROJECT_ROOT,
      process.env.GOOGLE_OAUTH_TOKEN || "credentials/token.json",
    ),
  };
}

// The old body of loadTargets, verbatim - parameterized per entry,
// with the entry's name in the error so "which one?" is obvious.
function validateTarget(parsed: Partial<Target>, index: number): Target {

  const label = parsed.restaurantName ?? `entry ${index}`;
  const mapsUrl = parsed.google?.mapsUrl ?? "";
  const yelpUrl = parsed.yelp?.businessUrl ?? "";

  // Placeholder URLs are the likeliest misconfiguration, and they fail in
  // confusing ways much later, so reject here.
  if (mapsUrl.includes("/place/...")) {
    throw new Error(`config/targets.json: google.mapsUrl is still a placeholder.`);
  }
  if (yelpUrl.endsWith("/biz/...")) {
    throw new Error(`config/targets.json: yelp.businessUrl is still a placeholder.`);
  }

  // Empty string = "this source did not resolve" (docs/specs/dynamic-targets.md).
  // One empty source is fine; a target with neither can never produce a review.
  if (!mapsUrl && !yelpUrl) {
    throw new Error(
      `config/targets.json: ${label} has neither a google.mapsUrl nor a yelp.businessUrl.`,
    );
  }

  return {
    restaurantName: parsed.restaurantName ?? "(unnamed)",
    google: { mapsUrl, placeId: parsed.google?.placeId || undefined },
    yelp: { businessUrl: yelpUrl },
  };
}
