import type { BrowserContext, Page } from "playwright";
import { pause } from "../browser.ts";
import { googleReviewId, slugifyAuthor, shortHash } from "../normalize.ts";
import type { NormalizedReview } from "../normalize.ts";
import { parseRelativeTimeToDay } from "./relativeTime.ts";
import { parseRatingLabel, SourceBlockedError, type RawReview } from "./types.ts";

/**
 * Pure mapping from scraped DOM data to normalized reviews. Kept separate from
 * the browser driving so it can be tested offline against fixtures — the
 * browser half changes whenever Google reshuffles its markup; this half doesn't.
 */
export function mapGoogleReviews(raw: RawReview[], now: Date): NormalizedReview[] {
  return raw.map((item) => {
    // Google's own review id is stable across edits and re-orderings, so it is
    // strongly preferred. The fallback keys on text, which means an edited
    // review would reappear as new — worse than a duplicate would be a MISSED
    // review, so we accept that trade rather than skipping the row.
    const reviewId = item.domId
      ? googleReviewId(item.domId)
      : `google:fallback:${slugifyAuthor(item.author)}:${shortHash(item.text)}`;

    return {
      source: "google" as const,
      reviewId,
      author: item.author.trim(),
      rating: parseRatingLabel(item.ratingLabel),
      reviewDate: parseRelativeTimeToDay(item.dateLabel, now),
      text: item.text.trim(),
      url: item.url ?? "",
      truncated: false,
    };
  });
}

export function countMissingDomIds(raw: RawReview[]): number {
  return raw.filter((item) => !item.domId).length;
}

export async function fetchGoogleReviews(
  context: BrowserContext,
  mapsUrl: string,
  now: Date,
): Promise<NormalizedReview[]> {
  const page = await openGoogleReviewsPage(context, mapsUrl);
  try {
    const raw = await extractReviews(page);
    if (raw.length === 0) {
      throw new Error(
        "Google Maps returned no review elements. Either the selectors are stale " +
          "or the page did not finish loading — run /fix-scrape.",
      );
    }
    return mapGoogleReviews(raw, now);
  } finally {
    await page.close();
  }
}

/**
 * Navigates to the sorted, fully-expanded review list and hands back the open
 * page. Shared with the screenshot enricher: review cards only exist here, so
 * capturing them means being on this exact page rather than re-visiting a
 * per-review permalink (Google Maps does not expose one).
 */
export async function openGoogleReviewsPage(
  context: BrowserContext,
  mapsUrl: string,
): Promise<Page> {
  const page = await context.newPage();
  try {
    await page.goto(mapsUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await dismissConsent(page);
    await openReviewsTab(page);
    await sortByNewest(page);
    await expandTruncatedText(page);
    return page;
  } catch (error) {
    await page.close().catch(() => {});
    throw error;
  }
}

async function dismissConsent(page: Page): Promise<void> {
  const consent = page.locator(
    'button[aria-label*="Accept"], button:has-text("Accept all"), form[action*="consent"] button',
  );
  if ((await consent.count()) > 0) {
    await consent
      .first()
      .click({ timeout: 5_000 })
      .catch(() => {});
    await pause(1_500);
  }
  if (page.url().includes("/sorry/")) {
    throw new SourceBlockedError("Google", "served the /sorry/ interstitial");
  }
}

async function openReviewsTab(page: Page): Promise<void> {
  const tab = page
    .locator(
      'button[role="tab"][aria-label*="Reviews"], button[jsaction*="reviewChart"]',
    )
    .first();
  // Maps renders the place panel well after domcontentloaded, so counting
  // matches immediately reports zero even when the tab is about to appear.
  // Wait for it rather than sampling once.
  try {
    await tab.waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    throw new Error(
      'Could not find the "Reviews" tab on the Google Maps listing. Run ' +
        "`npm run diagnose -- google` to see the tabs actually present.",
    );
  }
  // Deliberately NOT swallowed. Everything downstream — sorting by Newest, the
  // full review list — only exists inside this tab, so a failed click here
  // surfaces later as a confusing "no sort control" error instead.
  await tab.click({ timeout: 15_000 });
  // The review list is lazily rendered; 2s was not enough and left us probing
  // the overview panel.
  await page.waitForSelector("div[data-review-id]", { timeout: 20_000 });
  await pause(2_000);
}

/**
 * The whole point of the Google scraper. Places API (New) cannot sort by date,
 * so if this silently no-ops we are reading relevance-ranked reviews and will
 * miss new ones. Hence the throw rather than a warning.
 */
async function sortByNewest(page: Page): Promise<void> {
  const sortButton = page
    .locator(
      'button[aria-label*="Sort"], button[data-value="Sort"], button:has-text("Sort")',
    )
    .first();
  if ((await sortButton.count()) === 0) {
    throw new Error(
      "Could not find the Google Maps sort control. Without sorting by Newest we " +
        "would be reading relevance-ranked reviews and could miss new ones. Run /fix-scrape.",
    );
  }
  await sortButton.click({ timeout: 10_000 });
  await pause(1_000);

  const newest = page
    .locator(
      '[role="menuitemradio"]:has-text("Newest"), [role="menuitem"]:has-text("Newest")',
    )
    .first();
  if ((await newest.count()) === 0) {
    throw new Error('Sort menu opened but had no "Newest" option. Run /fix-scrape.');
  }
  await newest.click({ timeout: 10_000 });
  await pause(2_500);
}

/** Reviews longer than a few lines are collapsed behind a "More" button. */
async function expandTruncatedText(page: Page): Promise<void> {
  const more = page.locator('button[aria-label="See more"], button:has-text("More")');
  const count = Math.min(await more.count(), 20);
  for (let i = 0; i < count; i += 1) {
    await more
      .nth(i)
      .click({ timeout: 2_000 })
      .catch(() => {});
    await pause(120);
  }
}

export function extractReviews(page: Page): Promise<RawReview[]> {
  return page.$$eval("div[data-review-id]", (nodes) =>
    nodes
      // Google nests a second element carrying the SAME data-review-id inside
      // each review card, so a bare selector match returns every review twice.
      // Both copies parse to identical fields, so `selectNew` collapsed them and
      // the doc stayed correct — but the duplicates were counted before the
      // slice below, which quietly halved the real ceiling to 10 reviews, and
      // they doubled the "N review(s) visible" figure in the log. Keep only the
      // outermost node per card.
      .filter((node) => !node.parentElement?.closest("div[data-review-id]"))
      .filter((node) =>
        node.querySelector("[aria-label*='star'], [aria-label*='stars']"),
      )
      .slice(0, 20)
      .map((node) => {
        const text = (selector: string) =>
          node.querySelector(selector)?.textContent?.trim() ?? "";
        const stars = node.querySelector("[aria-label*='star'], [aria-label*='stars']");
        return {
          domId: node.getAttribute("data-review-id"),
          author: text(".d4r55") || text("[class*='fontTitleMedium']"),
          ratingLabel: stars?.getAttribute("aria-label") ?? "",
          dateLabel: text(".rsqaWe") || text("[class*='fontBodySmall'] span"),
          text: text(".wiI7pd") || text("[class*='fontBodyMedium'] span"),
          url:
            node.querySelector<HTMLAnchorElement>("a[href*='/reviews/']")?.href ??
            window.location.href,
        };
      }),
  );
}
