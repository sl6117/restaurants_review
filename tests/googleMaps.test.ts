import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { extractReviews } from "../src/sources/googleMaps.ts";

/**
 * Offline by construction (rule 1): this drives a local file:// fixture and
 * aborts every non-file request, so the suite still cannot reach the network.
 *
 * It needs a real DOM because the node-selection logic runs inside the page via
 * $$eval — the exact place the double-count bug lived, and the exact place unit
 * tests over plain objects cannot see.
 */
const FIXTURE = pathToFileURL(
  resolve(import.meta.dirname, "fixtures/google-reviews.html"),
).href;

describe("extractReviews", () => {
  let browser: Browser;
  let page: Page;

  before(async () => {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    page = await browser.newPage();
    await page.route("**/*", (route) =>
      route.request().url().startsWith("file://")
        ? route.continue()
        : route.abort(),
    );
    // Mirrors the shim in openBrowser(): tsx rewrites arrows with a `__name`
    // helper that does not exist inside the page.
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__name ??= (fn: unknown) => fn;
    });
    await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  });

  after(async () => {
    await browser?.close();
  });

  test("returns one row per review even though each id appears twice", async () => {
    const reviews = await extractReviews(page);

    // The fixture nests a second div[data-review-id] inside every card. Six
    // nodes match the selector; three are reviews.
    assert.equal(reviews.length, 3);
    assert.deepEqual(
      reviews.map((r) => r.domId),
      ["REVIEW_AAA", "REVIEW_BBB", "REVIEW_CCC"],
    );
  });

  test("never emits the same review id twice", async () => {
    const ids = (await extractReviews(page)).map((r) => r.domId);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("drops nodes with no rating, so owner replies are not reviews", async () => {
    const ids = (await extractReviews(page)).map((r) => r.domId);
    assert.ok(!ids.includes("REVIEW_DDD"));
  });

  test("reads fields off the card rather than the nested copy", async () => {
    const [first] = await extractReviews(page);
    assert.ok(first, "expected at least one review");
    assert.equal(first.author, "Reviewer One");
    assert.equal(first.ratingLabel, "5 stars");
    assert.equal(first.dateLabel, "2 weeks ago");
    assert.match(first.text, /tteokbokki/);
  });
});
