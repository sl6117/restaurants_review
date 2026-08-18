import { resolve } from "node:path";
import { loadTargets, loadEnv, PROJECT_ROOT } from "./config.ts";
import { openBrowser } from "./browser.ts";
import { fetchGoogleReviews } from "./sources/googleMaps.ts";
import { fetchYelpReviews } from "./sources/yelp.ts";
import { checkPlacesHealth, isScraperSilentlyBroken } from "./sources/googlePlaces.ts";
import { captureScreenshots } from "./enrich/screenshot.ts";
import { loadLedger, saveLedger, selectNew, withRecorded } from "./store/seen.ts";
import { loadAuthorizedClient } from "./store/googleAuth.ts";
import { uploadPublicImage, imageUrlCandidates } from "./store/drive.ts";
import {
  createDocClient,
  buildReviewRequests,
  chooseDocumentSource,
  createDocument,
  documentUrl,
  type DocRequest,
} from "./store/doc.ts";
import { readDocState, writeDocState } from "./store/docState.ts";
import { appendFile } from "node:fs/promises";
import { slugifyRestaurantName, type NormalizedReview } from "./normalize.ts";

const LEDGER_PATH = resolve(PROJECT_ROOT, "data/seen.json");
const REVIEWS_LOG_PATH = resolve(PROJECT_ROOT, "data/reviews.jsonl");
const DOC_STATE_PATH = resolve(PROJECT_ROOT, "data/document.json");
const dryRun = process.argv.includes("--dry-run");
// Lets a dry run prove screenshot capture without any credentials configured.
const wantScreenshots = !dryRun || process.argv.includes("--screenshots");

// The JSONL line = NormalizedReview + attribution. This type IS the frozen
// interface the reporter track consumes.
type ArchivedReview = NormalizedReview & { restaurantName: string };

interface SourceOutcome {
  name: string;
  reviews: NormalizedReview[];
  error: Error | null;
}

async function main(): Promise<number> {
  const now = new Date();
  const warnings: string[] = [];
  const warn = (message: string) => {
    warnings.push(message);
    console.warn(`  ! ${message}`);
  };

  const targets = await loadTargets();
  const env = dryRun ? safeEnv() : loadEnv();

  const context = await openBrowser();
  const outcomes: SourceOutcome[] = [];
  const fresh: ArchivedReview[] = [];
  const ledger = await loadLedger(LEDGER_PATH);

  try {
    for (const target of targets) {
      console.log(
        `Checking reviews for ${target.restaurantName}${dryRun ? " (dry run)" : ""}`,
      );

      // Labels carry the restaurant so a failure names its target. A target
      // resolved from only one source has an empty URL for the other — skip it.
      const google = target.google.mapsUrl
        ? await runSource(`${target.restaurantName}/google`, () =>
            fetchGoogleReviews(context, target.google.mapsUrl, now),
          )
        : skipSource(`${target.restaurantName}/google`);
      const yelp = target.yelp.businessUrl
        ? await runSource(`${target.restaurantName}/yelp`, () =>
            fetchYelpReviews(context, target.yelp.businessUrl),
          )
        : skipSource(`${target.restaurantName}/yelp`);
      outcomes.push(google, yelp);

      // Health check: distinguishes "quiet week" from "scraper broke". Only
      // meaningful when the Google scrape came back empty without erroring.
      if (
        target.google.mapsUrl &&
        !google.error &&
        google.reviews.length === 0 &&
        env.googleMapsApiKey &&
        target.google.placeId
      ) {
        const health = await checkPlacesHealth(
          env.googleMapsApiKey,
          target.google.placeId,
        );
        if (isScraperSilentlyBroken(0, health)) {
          google.error = new Error(
            `Google scraper returned nothing but ${health.detail}. The scraper is ` +
              `broken, not the week. Run /fix-scrape.`,
          );
        }
      }

      const scraped = [...google.reviews, ...yelp.reviews];
      const restaurantSlug = slugifyRestaurantName(target.restaurantName);
      const scopedReviews = scraped.map((review) => ({
        ...review,
        reviewId: `${restaurantSlug}:${review.reviewId}`,
      }));
      let targetFresh = selectNew(scopedReviews, ledger);
      console.log(`  ${scraped.length} review(s) visible; ${targetFresh.length} new.`);

      if (targetFresh.length > 0 && wantScreenshots) {
        targetFresh = await captureScreenshots(
          context,
          targetFresh,
          { mapsUrl: target.google.mapsUrl, businessUrl: target.yelp.businessUrl },
          warn,
        );
      }

      fresh.push(
        ...targetFresh.map((r) => ({ ...r, restaurantName: target.restaurantName })),
      );
    }

    console.log(`Found ${fresh.length} new review(s) across all restaurants.`);

    if (dryRun) {
      for (const review of fresh) {
        console.log(
          `  NEW  [${review.restaurantName}/${review.source}] ${review.rating}★ ` +
            `${review.author} (${review.reviewDate})\n` +
            `       ${review.text.slice(0, 140)}${review.text.length > 140 ? "…" : ""}` +
            (review.screenshotPath ? `\n       shot: ${review.screenshotPath}` : ""),
        );
      }
      console.log(`\nDry run — nothing written to the doc or the ledger.`);
    } else if (fresh.length > 0) {
      const auth = await loadAuthorizedClient(env.oauthClientPath, env.oauthTokenPath);
      const documentId = await resolveDocument(
        auth,
        env.documentId,
        "Restaurant Reviews",
      );
      const doc = createDocClient(auth, documentId);
      // Fail before uploading anything if the doc is wrong or unreachable.
      await doc.assertReachable();

      const requests: DocRequest[] = [];
      for (const review of fresh) {
        requests.push(
          ...buildReviewRequests(review, await hostImage(auth, review, warn)),
        );
      }
      await doc.append(requests);

      // Ledger and archive are written only AFTER a successful append. If the
      // append throws, nothing is recorded and the next run retries — a
      // duplicate entry is recoverable, a silently lost review is not.
      await appendReviewsLog(fresh);
      await saveLedger(LEDGER_PATH, withRecorded(ledger, fresh), now.toISOString());
      console.log(`Appended ${fresh.length} review(s) to ${documentUrl(documentId)}`);
    } else {
      await saveLedger(LEDGER_PATH, ledger, now.toISOString());
      console.log("Nothing new.");
    }
  } finally {
    await context.close().catch(() => {});
  }

  const failed = outcomes.filter((o) => o.error);
  for (const outcome of failed) {
    console.error(`FAILED [${outcome.name}] ${outcome.error!.message}`);
  }
  if (warnings.length > 0) {
    console.log(
      `${warnings.length} warning(s) — screenshots only, reviews were still recorded.`,
    );
  }

  // Non-zero exit so launchd surfaces a broken source in the logs rather than
  // this failing quietly every morning.
  return failed.length > 0 ? 1 : 0;
}

async function appendReviewsLog(reviews: ArchivedReview[]): Promise<void> {
  if (reviews.length === 0) return;
  const lines = reviews.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await appendFile(REVIEWS_LOG_PATH, lines, "utf8");
}

async function runSource(
  name: string,
  fetch: () => Promise<NormalizedReview[]>,
): Promise<SourceOutcome> {
  try {
    const reviews = await fetch();
    console.log(`  ${name}: ${reviews.length} review(s) visible`);
    return { name, reviews, error: null };
  } catch (error) {
    // One source failing must not stop the other from being recorded.
    console.error(`  ${name}: ${(error as Error).message}`);
    return { name, reviews: [], error: error as Error };
  }
}

function skipSource(name: string): SourceOutcome {
  console.log(`  ${name}: skipped — no URL configured`);
  return { name, reviews: [], error: null };
}

/** Dry runs must work before any credentials exist. */
function safeEnv() {
  return {
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || null,
    documentId: "",
    oauthClientPath: "",
    oauthTokenPath: "",
  };
}

/**
 * Finds the review doc, creating it on first run.
 *
 * With only the `drive.file` scope the app cannot open a manually created doc by
 * hand, so the script owns creation. The id is persisted because losing it
 * would silently start a second doc and split the review history.
 */
async function resolveDocument(
  auth: Awaited<ReturnType<typeof loadAuthorizedClient>>,
  envDocumentId: string,
  title: string,
): Promise<string> {
  const stored = await readDocState(DOC_STATE_PATH);
  const source = chooseDocumentSource(envDocumentId || undefined, stored?.documentId);
  if (source.kind !== "create") return source.id;

  const documentId = await createDocument(auth, `${title} — Reviews`);
  await writeDocState(DOC_STATE_PATH, {
    documentId,
    createdAt: new Date().toISOString(),
  });
  console.log(`\nCreated your review doc:\n  ${documentUrl(documentId)}\n`);
  return documentId;
}

/**
 * Uploads a screenshot and returns a URL the Docs API can fetch, or null.
 *
 * Google has moved which host serves Drive images to third-party fetchers more
 * than once, and insertInlineImage fails the WHOLE batch on a URL it cannot
 * fetch — which would lose the text of every review in the run, not just an
 * image. So each candidate URL is verified reachable before being used.
 */
async function hostImage(
  auth: Awaited<ReturnType<typeof loadAuthorizedClient>>,
  review: NormalizedReview,
  warn: (message: string) => void,
): Promise<string | null> {
  if (!review.screenshotPath) return null;
  try {
    const fileId = await uploadPublicImage(auth, review.screenshotPath);
    for (const url of imageUrlCandidates(fileId)) {
      const probe = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null);
      if (probe?.ok) return url;
    }
    warn(`Uploaded ${review.reviewId} but no public URL served it; embedding skipped.`);
    return null;
  } catch (error) {
    warn(`Image upload failed for ${review.reviewId}: ${(error as Error).message}`);
    return null;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`Fatal: ${(error as Error).message}`);
    process.exit(1);
  });
