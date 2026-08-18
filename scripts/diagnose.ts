/**
 * Step 2 of /fix-scrape: capture ground truth.
 *
 * Opens a source in the real browser, saves HTML + a screenshot to logs/, and
 * prints the interactive elements actually present. Selector guesses made
 * without this are how scrapers get "fixed" into a different kind of broken.
 *
 *   npm run diagnose -- google
 *   npm run diagnose -- yelp
 */
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { loadTargets, PROJECT_ROOT } from "../src/config.ts";
import { openBrowser, pause } from "../src/browser.ts";

const which = process.argv[2];
if (which !== "google" && which !== "yelp") {
  console.error("Usage: npm run diagnose -- google|yelp");
  process.exit(1);
}

const [target] = await loadTargets();
if (!target) throw new Error("config/targets.json has no targets.");
const url = which === "google" ? target.google.mapsUrl : target.yelp.businessUrl;
const outDir = resolve(PROJECT_ROOT, "logs");
await mkdir(outDir, { recursive: true });

const context = await openBrowser();
const page = await context.newPage();

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
await pause(5_000);

console.log(`\nURL after load: ${page.url()}`);
console.log(`Title: ${await page.title()}\n`);

const probe = await page.evaluate(() => {
  const label = (el: Element) =>
    (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 70);
  return {
    buttons: [...document.querySelectorAll("button")]
      .map(label)
      .filter(Boolean)
      .slice(0, 45),
    tabs: [...document.querySelectorAll('[role="tab"]')].map(label).slice(0, 15),
    reviewNodes: document.querySelectorAll("div[data-review-id]").length,
    starNodes: document.querySelectorAll("[aria-label*='star'],[aria-label*='stars']")
      .length,
    captcha: document.querySelectorAll(
      'iframe[src*="captcha"],#px-captcha,[id*="px-captcha"]',
    ).length,
    bodyStart: document.body.innerText.slice(0, 400),
  };
});

console.log(`Elements with data-review-id: ${probe.reviewNodes}`);
console.log(`Elements with a star aria-label: ${probe.starNodes}`);
console.log(`CAPTCHA-ish nodes: ${probe.captcha}\n`);
console.log(`Tabs: ${JSON.stringify(probe.tabs, null, 2)}\n`);
console.log(`Buttons:\n${probe.buttons.map((b) => `  - ${b}`).join("\n")}\n`);
console.log(`Body starts:\n${probe.bodyStart}\n`);

// The Google sort control only exists inside the Reviews tab, so probing the
// overview page alone cannot tell you whether the selector is right.
if (which === "google") {
  const tab = page.locator('button[role="tab"][aria-label*="Reviews"]').first();
  console.log(`\n--- clicking Reviews tab (found: ${await tab.count()}) ---`);
  await tab.click({ timeout: 15_000 });
  await pause(4_000);

  const after = await page.evaluate(() => ({
    buttons: [...document.querySelectorAll("button")]
      .map((el) =>
        (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 70),
      )
      .filter((t) => /sort|newest|relevan/i.test(t)),
    reviewNodes: document.querySelectorAll("div[data-review-id]").length,
  }));
  console.log(`data-review-id nodes now: ${after.reviewNodes}`);
  console.log(`sort-ish buttons: ${JSON.stringify(after.buttons, null, 2)}`);

  const sample = await page.evaluate(() => {
    const node = document.querySelector("div[data-review-id]");
    if (!node) return null;
    return {
      id: node.getAttribute("data-review-id"),
      d4r55: node.querySelector(".d4r55")?.textContent?.trim() ?? null,
      rsqaWe: node.querySelector(".rsqaWe")?.textContent?.trim() ?? null,
      wiI7pd: node.querySelector(".wiI7pd")?.textContent?.trim().slice(0, 90) ?? null,
      star: node
        .querySelector("[aria-label*='star'],[aria-label*='stars']")
        ?.getAttribute("aria-label"),
    };
  });
  console.log(
    `\nFirst review node via current selectors:\n${JSON.stringify(sample, null, 2)}`,
  );
}

if (which === "yelp") {
  const sample = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("li")].filter(
      (n) =>
        n.querySelector('[aria-label*="star rating"]') &&
        n.querySelector('a[href^="/user_details"]'),
    );
    const node = nodes[0];
    if (!node) return { count: 0 };
    const anchors = [...node.querySelectorAll<HTMLAnchorElement>("a")].map((a) => ({
      href: a.getAttribute("href"),
      text: a.textContent?.trim().slice(0, 40),
    }));
    const paragraphs = [...node.querySelectorAll("p")].map((p) => ({
      cls: p.className.slice(0, 60),
      text: p.textContent?.trim().slice(0, 60),
    }));
    return {
      count: nodes.length,
      anchors,
      paragraphs,
      html: node.innerHTML.slice(0, 600),
    };
  });
  console.log(`\nYelp review nodes: ${sample.count}`);
  console.log(`Anchors:\n${JSON.stringify(sample.anchors, null, 2)}`);
  console.log(`Paragraphs:\n${JSON.stringify(sample.paragraphs, null, 2)}`);
}

const stamp = `${which}-${page.url().includes("sorry") ? "blocked" : "ok"}`;
await writeFile(resolve(outDir, `${stamp}.html`), await page.content(), "utf8");
await page.screenshot({ path: resolve(outDir, `${stamp}.png`), fullPage: false });
console.log(`Saved logs/${stamp}.html and logs/${stamp}.png`);

await context.close();
