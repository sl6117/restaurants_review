import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  filterMonth,
  groupByRestaurant,
  previousMonth,
  readArchive,
} from "./archive.ts";
import { reportPath, resolveMonth } from "./cli.ts";
import { createAnthropicCompleter } from "./client.ts";
import { buildReport } from "./report.ts";

// Deliberately not importing src/config.ts: the reporter reads the archive and
// nothing else — no targets, no detector configuration.
const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const ARCHIVE_PATH = resolve(PROJECT_ROOT, "data/reviews.jsonl");

async function main(): Promise<number> {
  const month = resolveMonth(process.argv.slice(2), new Date());

  const archive = await readArchive(ARCHIVE_PATH).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (archive === null) {
    console.error(`No archive at ${ARCHIVE_PATH} — run \`npm run check\` first.`);
    return 1;
  }

  const monthReviews = filterMonth(archive, month);
  if (monthReviews.length === 0) {
    console.log(`No archived reviews for ${month}; nothing to report.`);
    return 0;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      "ANTHROPIC_API_KEY is not set; the reporter needs it for Haiku/Sonnet.",
    );
    return 1;
  }
  const complete = createAnthropicCompleter(apiKey);

  // Prior-month reviews come from the full archive, not the month slice.
  const byRestaurant = groupByRestaurant(archive);
  for (const [restaurantName, allReviews] of byRestaurant) {
    const reviews = filterMonth(allReviews, month);
    if (reviews.length === 0) continue;
    console.log(
      `Reporting on ${restaurantName} for ${month} (${reviews.length} review(s))`,
    );

    const markdown = await buildReport({
      restaurantName,
      month,
      reviews,
      priorMonthReviews: filterMonth(allReviews, previousMonth(month)),
      complete,
    });

    const path = reportPath(PROJECT_ROOT, restaurantName, month);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, markdown, "utf8");
    console.log(`  wrote ${path}`);
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`Fatal: ${(error as Error).message}`);
    process.exit(1);
  });
