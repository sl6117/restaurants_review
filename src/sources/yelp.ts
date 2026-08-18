import type { BrowserContext, Page } from "playwright";
import { pause } from "../browser.ts";
import { yelpReviewId, resolveIdCollisions } from "../normalize.ts";
import type { NormalizedReview } from "../normalize.ts";
import { parseRatingLabel, SourceBlockedError } from "./types.ts";

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * Yelp prints absolute dates, unlike Google. Both renderings seen in the wild
 * are handled; anything else throws rather than silently dating a review today,
 * because the date is half of the Yelp dedupe key.
 */
export function parseYelpDate(input: string): string {
  const text = input.trim();

  const named = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (named) {
    const month = MONTHS[named[1]!.slice(0, 3).toLowerCase()];
    if (month === undefined) throw new Error(`Unparseable Yelp date: "${input}"`);
    return iso(Number(named[3]), month, Number(named[2]));
  }

  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (numeric) {
    return iso(Number(numeric[3]), Number(numeric[1]) - 1, Number(numeric[2]));
  }

  throw new Error(`Unparseable Yelp date: "${input}"`);
}

function iso(year: number, monthIndex: number, day: number): string {
  const date = new Date(Date.UTC(year, monthIndex, day));
  // Rejects impossible dates like 2/30 that Date would roll forward silently.
  if (date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) {
    throw new Error(`Impossible Yelp date: ${year}-${monthIndex + 1}-${day}`);
  }
  return date.toISOString().slice(0, 10);
}

/**
 * A Yelp review <li> holds two `/user_details` links: an avatar with no text,
 * then the display name. Taking the first match yields an empty author — which
 * silently corrupts dedupe, since the Yelp review id is author + date.
 */
export function pickAuthor(candidates: string[]): string {
  const name = candidates.map((c) => c.trim()).find((c) => c.length > 0);
  if (!name) {
    throw new Error(
      "No Yelp author name found. The display-name link moved — run " +
        "`npm run diagnose -- yelp`. Refusing to continue, because an empty " +
        "author makes every same-day review collide on one id.",
    );
  }
  return name;
}

/**
 * The same <li> also contains the owner's reply, in a second `comment__`
 * paragraph. Concatenating them puts the restaurant's own words in the review
 * column. The reviewer's comment always precedes the reply in document order.
 */
export function pickReviewText(comments: string[]): string {
  return comments.map((c) => c.trim()).find((c) => c.length > 0) ?? "";
}

/** What the page hands back: candidates, not decisions. */
export interface YelpRawNode {
  authorCandidates: string[];
  ratingLabel: string;
  dateLabel: string;
  commentCandidates: string[];
  url: string | null;
}

export function mapYelpReviews(
  raw: YelpRawNode[],
  businessUrl: string,
): NormalizedReview[] {
  const mapped = raw.map((item) => {
    const author = pickAuthor(item.authorCandidates);
    const reviewDate = parseYelpDate(item.dateLabel);
    return {
      source: "yelp" as const,
      reviewId: yelpReviewId(author, reviewDate),
      author,
      rating: parseRatingLabel(item.ratingLabel),
      reviewDate,
      text: pickReviewText(item.commentCandidates),
      url: item.url ?? businessUrl,
      truncated: false,
    };
  });
  // Yelp has no stable id, so two same-day reviews by one author collide.
  return resolveIdCollisions(mapped);
}

export async function fetchYelpReviews(
  context: BrowserContext,
  businessUrl: string,
): Promise<NormalizedReview[]> {
  const page = await openYelpReviewsPage(context, businessUrl);
  try {
    const raw = await extractReviews(page);
    if (raw.length === 0) {
      throw new Error(
        "Yelp returned no review elements. Most likely a soft block or a markup " +
          "change — run /fix-scrape to tell them apart before editing selectors.",
      );
    }
    return mapYelpReviews(raw, businessUrl);
  } finally {
    await page.close();
  }
}

/** Shared with the screenshot enricher — see openGoogleReviewsPage. */
export async function openYelpReviewsPage(
  context: BrowserContext,
  businessUrl: string,
): Promise<Page> {
  const page = await context.newPage();
  try {
    const url = new URL(businessUrl);
    url.searchParams.set("sort_by", "date_desc");
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
    await pause(2_500);
    await assertNotBlocked(page);
    await expandTruncatedText(page);
    return page;
  } catch (error) {
    await page.close().catch(() => {});
    throw error;
  }
}

async function assertNotBlocked(page: Page): Promise<void> {
  const title = (await page.title()).toLowerCase();
  const blockedTitle =
    title.includes("access denied") ||
    title.includes("blocked") ||
    title.includes("are you a human") ||
    title.includes("just a moment");
  const hasCaptcha =
    (await page
      .locator('iframe[src*="captcha"], #px-captcha, [id*="px-captcha"]')
      .count()) > 0;

  if (blockedTitle || hasCaptcha) {
    throw new SourceBlockedError(
      "Yelp",
      blockedTitle ? `page title "${title}"` : "CAPTCHA present",
    );
  }
}

/** Long reviews are collapsed behind "Read more"; expand before extracting. */
async function expandTruncatedText(page: Page): Promise<void> {
  const more = page.getByRole("button", { name: /read more/i });
  const count = Math.min(await more.count(), 20);
  for (let i = 0; i < count; i += 1) {
    await more
      .nth(i)
      .click({ timeout: 2_000 })
      .catch(() => {});
    await pause(120);
  }
}

/**
 * The in-page half stays dumb on purpose: it collects candidates and does no
 * choosing. Picking among them happens in pickAuthor/pickReviewText, which are
 * plain functions with tests — the browser half cannot be unit-tested.
 */
function extractReviews(page: Page): Promise<YelpRawNode[]> {
  return page.$$eval("li", (nodes) =>
    nodes
      .filter((node) => {
        const hasRating = node.querySelector(
          '[aria-label*="star rating"], [role="img"][aria-label*="star"]',
        );
        const hasAuthor = node.querySelector('a[href^="/user_details"]');
        return Boolean(hasRating && hasAuthor);
      })
      .slice(0, 20)
      .map((node) => {
        const rating = node.querySelector(
          '[aria-label*="star rating"], [role="img"][aria-label*="star"]',
        );
        // The date is matched by shape, not class: Yelp's class names carry a
        // per-build hash, but "Jul 28, 2026" looks the same every build. The
        // owner reply also carries a date, and always comes later in the DOM,
        // so taking the first match keeps the reviewer's.
        const dateNode = [...node.querySelectorAll("span, p")].find((el) =>
          /^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}$|^\d{1,2}\/\d{1,2}\/\d{4}$/.test(
            el.textContent?.trim() ?? "",
          ),
        );

        return {
          authorCandidates: [
            ...node.querySelectorAll<HTMLAnchorElement>('a[href^="/user_details"]'),
          ].map((a) => a.textContent ?? ""),
          ratingLabel: rating?.getAttribute("aria-label") ?? "",
          dateLabel: dateNode?.textContent?.trim() ?? "",
          commentCandidates: [...node.querySelectorAll('p[class*="comment__"]')].map(
            (p) => p.textContent ?? "",
          ),
          url: null,
        };
      }),
  );
}
