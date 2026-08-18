import { readFile } from "node:fs/promises";
import { toIsoDay, type NormalizedReview } from "../normalize.ts";

/**
 * One line of `data/reviews.jsonl` — the frozen interface between the
 * detection track (which appends) and this reporter (which only reads).
 */
export type ArchivedReview = NormalizedReview & { restaurantName: string };

/** Reads the whole archive. A missing file is an error the caller words. */
export async function readArchive(path: string): Promise<ArchivedReview[]> {
  const raw = await readFile(path, "utf8");
  const reviews: ArchivedReview[] = [];
  for (const [index, line] of raw.split("\n").entries()) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`${path}:${index + 1} is not valid JSON`);
    }
    reviews.push(assertArchivedReview(parsed, `${path}:${index + 1}`));
  }
  return reviews;
}

function assertArchivedReview(value: unknown, where: string): ArchivedReview {
  const r = value as Partial<ArchivedReview>;
  const ok =
    r !== null &&
    typeof r === "object" &&
    typeof r.restaurantName === "string" &&
    typeof r.reviewId === "string" &&
    typeof r.reviewDate === "string" &&
    typeof r.text === "string" &&
    typeof r.rating === "number";
  if (!ok) throw new Error(`${where} is not an archived review`);
  return value as ArchivedReview;
}

/** UTC calendar month (`YYYY-MM`) a review belongs to. */
export function monthOf(review: ArchivedReview): string {
  return toIsoDay(review.reviewDate).slice(0, 7);
}

export function filterMonth(
  reviews: ArchivedReview[],
  month: string,
): ArchivedReview[] {
  return reviews.filter((review) => monthOf(review) === month);
}

/** Groups by display name, preserving archive order within each group. */
export function groupByRestaurant(
  reviews: ArchivedReview[],
): Map<string, ArchivedReview[]> {
  const groups = new Map<string, ArchivedReview[]>();
  for (const review of reviews) {
    const group = groups.get(review.restaurantName);
    if (group) group.push(review);
    else groups.set(review.restaurantName, [review]);
  }
  return groups;
}

/** `2026-01` -> `2025-12`. */
export function previousMonth(month: string): string {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error(`Not a YYYY-MM month: "${month}"`);
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return date.toISOString().slice(0, 7);
}
