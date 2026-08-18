import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { NormalizedReview } from "../normalize.ts";

export interface SeenLedger {
  version: 1;
  lastRunAt: string | null;
  /** Review IDs already written to the sheet. */
  ids: string[];
}

const EMPTY: SeenLedger = { version: 1, lastRunAt: null, ids: [] };

export async function loadLedger(path: string): Promise<SeenLedger> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { ...EMPTY, ids: [] };
    throw error;
  }

  // A truncated or hand-edited ledger must not silently reset to empty — that
  // would re-append every review to the sheet on the next run.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `${path} is not valid JSON. Refusing to run: treating it as empty would ` +
        `duplicate every review in the sheet. Restore it from git or delete it deliberately.`,
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as SeenLedger).ids)
  ) {
    throw new Error(`${path} is missing its "ids" array. Refusing to run.`);
  }

  const ledger = parsed as SeenLedger;
  return {
    version: 1,
    lastRunAt: ledger.lastRunAt ?? null,
    ids: ledger.ids.filter((id): id is string => typeof id === "string"),
  };
}

/** Returns only the reviews whose IDs are absent from the ledger. */
export function selectNew(
  reviews: NormalizedReview[],
  ledger: SeenLedger,
): NormalizedReview[] {
  const seen = new Set(ledger.ids);
  const fresh: NormalizedReview[] = [];
  for (const review of reviews) {
    if (seen.has(review.reviewId)) continue;
    // Guards against a single batch containing the same ID twice.
    seen.add(review.reviewId);
    fresh.push(review);
  }
  return fresh;
}

/**
 * Writes via temp-file + rename so an interrupted run cannot leave a half-written
 * ledger behind. A corrupt ledger is the one failure that duplicates the sheet.
 */
export async function saveLedger(
  path: string,
  ledger: SeenLedger,
  now: string,
): Promise<void> {
  const next: SeenLedger = {
    version: 1,
    lastRunAt: now,
    ids: [...new Set(ledger.ids)].sort(),
  };
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

export function withRecorded(
  ledger: SeenLedger,
  reviews: NormalizedReview[],
): SeenLedger {
  return { ...ledger, ids: [...ledger.ids, ...reviews.map((r) => r.reviewId)] };
}
