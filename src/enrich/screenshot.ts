import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { BrowserContext, Locator, Page } from "playwright";
import { PROJECT_ROOT } from "../config.ts";
import { openGoogleReviewsPage } from "../sources/googleMaps.ts";
import { openYelpReviewsPage } from "../sources/yelp.ts";
import type { NormalizedReview } from "../normalize.ts";

const SCREENSHOT_DIR = resolve(PROJECT_ROOT, "screenshots");

/**
 * Best-effort by design. Every failure is swallowed into a warning: a row
 * without a screenshot is a minor loss, a missed review is not. This must never
 * throw into the run.
 *
 * Neither site exposes a per-review permalink, so capture happens on the same
 * sorted review list the scraper used — one page load per source, not one per
 * review.
 */
export async function captureScreenshots(
  context: BrowserContext,
  reviews: NormalizedReview[],
  targets: { mapsUrl: string; businessUrl: string },
  warn: (message: string) => void,
): Promise<NormalizedReview[]> {
  if (reviews.length === 0) return reviews;
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  const byId = new Map<string, string>();
  const google = reviews.filter((r) => r.source === "google");
  const yelp = reviews.filter((r) => r.source === "yelp");

  if (google.length > 0) {
    await onPage(
      () => openGoogleReviewsPage(context, targets.mapsUrl),
      "google",
      warn,
      async (page) => {
        for (const review of google) {
          const id = review.reviewId.replace(/^google:/, "");
          const card = page.locator(`div[data-review-id="${cssQuote(id)}"]`).first();
          await capture(card, review, byId, warn);
        }
      },
    );
  }

  if (yelp.length > 0) {
    await onPage(
      () => openYelpReviewsPage(context, targets.businessUrl),
      "yelp",
      warn,
      async (page) => {
        for (const review of yelp) {
          // Yelp list items carry no id, so the review is located by the
          // display-name link inside it.
          const card = page
            .locator("li")
            .filter({
              has: page.locator(
                `a[href^="/user_details"]:text-is("${cssQuote(review.author)}")`,
              ),
            })
            .first();
          await capture(card, review, byId, warn);
        }
      },
    );
  }

  return reviews.map((review) => {
    const path = byId.get(review.reviewId);
    return path ? { ...review, screenshotPath: path } : review;
  });
}

async function onPage(
  open: () => Promise<Page>,
  source: string,
  warn: (message: string) => void,
  work: (page: Page) => Promise<void>,
): Promise<void> {
  let page: Page | null = null;
  try {
    page = await open();
    await work(page);
  } catch (error) {
    warn(`Screenshot pass for ${source} failed: ${(error as Error).message}`);
  } finally {
    await page?.close().catch(() => {});
  }
}

async function capture(
  card: Locator,
  review: NormalizedReview,
  byId: Map<string, string>,
  warn: (message: string) => void,
): Promise<void> {
  const file = resolve(
    SCREENSHOT_DIR,
    `${review.reviewDate}-${review.source}-${safeName(review.reviewId)}.png`,
  );
  try {
    if ((await card.count()) === 0) {
      warn(`Could not locate the review card for ${review.reviewId}.`);
      return;
    }
    await card.scrollIntoViewIfNeeded({ timeout: 5_000 });
    await card.screenshot({ path: file, timeout: 10_000 });
    byId.set(review.reviewId, file);
  } catch (error) {
    warn(`Screenshot failed for ${review.reviewId}: ${(error as Error).message}`);
  }
}

function safeName(reviewId: string): string {
  return reviewId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

/** Guards against a name or id containing a quote breaking out of the selector. */
function cssQuote(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
