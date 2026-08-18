import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PROJECT_ROOT } from "../config.ts";
import { canonicalizeYelpUrl } from "./yelpSearch.ts";
import type {
  GoogleResolution,
  ParsedInput,
  ResolvedTarget,
  YelpResolution,
} from "./types.ts";

export const TARGETS_PATH = resolve(PROJECT_ROOT, "config/targets.json");

/** Existing entries may be hand-written, so every field is optional here. */
export interface StoredTarget {
  restaurantName?: string;
  google?: { mapsUrl?: string; placeId?: string };
  yelp?: { businessUrl?: string };
}

export async function readTargetsFile(path = TARGETS_PATH): Promise<StoredTarget[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${path} must be an ARRAY of targets. Fix it before appending.`);
  }
  return parsed as StoredTarget[];
}

export function buildTarget(
  parsed: ParsedInput,
  google: GoogleResolution,
  yelp: YelpResolution,
): ResolvedTarget {
  return {
    // Prefer an API's official spelling of the name over the free-text guess.
    restaurantName: google.displayName || yelp.name || parsed.name,
    google: { mapsUrl: google.mapsUrl, placeId: google.placeId },
    yelp: { businessUrl: yelp.businessUrl },
  };
}

/**
 * Duplicate = same non-empty placeId OR same non-empty Yelp businessUrl.
 * Empty strings never count as a match (spec rule). Stored Yelp URLs are
 * canonicalized before comparing so hand-pasted tracking params don't hide
 * a duplicate.
 */
export function findDuplicate(
  existing: StoredTarget[],
  candidate: ResolvedTarget,
): string | null {
  for (const entry of existing) {
    const label = entry.restaurantName ?? "(unnamed)";
    if (candidate.google.placeId && entry.google?.placeId === candidate.google.placeId) {
      return `placeId ${candidate.google.placeId} is already tracked as "${label}"`;
    }
    const entryUrl = entry.yelp?.businessUrl
      ? canonicalizeYelpUrl(entry.yelp.businessUrl)
      : "";
    if (candidate.yelp.businessUrl && entryUrl === candidate.yelp.businessUrl) {
      return `Yelp URL ${candidate.yelp.businessUrl} is already tracked as "${label}"`;
    }
  }
  return null;
}

export async function appendTarget(
  path: string,
  existing: StoredTarget[],
  target: ResolvedTarget,
): Promise<void> {
  await writeFile(path, JSON.stringify([...existing, target], null, 2) + "\n", "utf8");
}
