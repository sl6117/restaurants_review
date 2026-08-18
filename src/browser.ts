import { chromium, type BrowserContext } from "playwright";
import { resolve } from "node:path";
import { PROJECT_ROOT } from "./config.ts";

/**
 * One persistent, real-Chrome context shared by every source in a run.
 *
 * Deliberately NOT stock headless Chromium: a real Chrome build with a
 * persistent profile keeps cookies and a consistent fingerprint across days,
 * which is what makes one visit per day look like a person rather than a bot.
 * `headless: false` matters for the same reason — a window will briefly appear.
 *
 * This is fingerprint hygiene, not evasion. If a site blocks us anyway, that is
 * an answer to respect, not a puzzle to solve.
 */
export async function openBrowser(): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(
    resolve(PROJECT_ROOT, ".chrome-profile"),
    {
      channel: "chrome",
      headless: false,
      viewport: { width: 1440, height: 1000 },
      locale: "en-US",
      timezoneId: "America/Los_Angeles",
      args: ["--disable-blink-features=AutomationControlled"],
    },
  );

  // tsx/esbuild rewrites arrow functions with a `__name` helper for stack-trace
  // names. Playwright serializes evaluate/$$eval callbacks and runs them inside
  // the page, where that helper does not exist — every callback containing a
  // local arrow function throws "__name is not defined". Shimming it on every
  // new document fixes all sources at once.
  await context.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__name ??= (fn: unknown) => fn;
  });

  return context;
}

/** Human-ish pause. Sources call this between actions rather than hammering. */
export function pause(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}
