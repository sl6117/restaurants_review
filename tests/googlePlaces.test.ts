import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  checkPlacesHealth,
  isScraperSilentlyBroken,
} from "../src/sources/googlePlaces.ts";

// checkPlacesHealth calls the global fetch directly, so these tests swap it out
// for a stub. Nothing here touches the network (repo rule 1).
const realFetch = globalThis.fetch;
const FAKE_KEY = "TEST_KEY_not_real";

interface Captured {
  url: string;
  headers: Record<string, string>;
}

function stubFetch(respond: () => Promise<Response>): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return respond();
  }) as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("checkPlacesHealth", () => {
  test("asks Places for the rating count with the key in a header, not the URL", async () => {
    const calls = stubFetch(() => json({ userRatingCount: 7 }));
    await checkPlacesHealth(FAKE_KEY, "ChIJ/odd id");

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0]!.url,
      "https://places.googleapis.com/v1/places/ChIJ%2Fodd%20id",
    );
    assert.equal(calls[0]!.headers["x-goog-api-key"], FAKE_KEY);
    assert.match(calls[0]!.headers["x-goog-fieldmask"]!, /userRatingCount/);
    assert.ok(!calls[0]!.url.includes(FAKE_KEY));
  });

  test("reports the listing's rating count when reachable", async () => {
    stubFetch(() => json({ id: "ChIJ_A", userRatingCount: 42 }));
    assert.deepEqual(await checkPlacesHealth(FAKE_KEY, "ChIJ_A"), {
      reachable: true,
      totalRatingCount: 42,
      detail: "Places API reports 42 ratings",
    });
  });

  test("treats a listing with no userRatingCount as zero ratings", async () => {
    stubFetch(() => json({ id: "ChIJ_A" }));
    const health = await checkPlacesHealth(FAKE_KEY, "ChIJ_A");
    assert.equal(health.reachable, true);
    assert.equal(health.totalRatingCount, 0);
  });

  test("an HTTP error is unreachable and never echoes the response body", async () => {
    stubFetch(() => json({ error: { message: `API key ${FAKE_KEY} not valid` } }, 403));
    const health = await checkPlacesHealth(FAKE_KEY, "ChIJ_A");
    assert.deepEqual(health, {
      reachable: false,
      totalRatingCount: null,
      detail: "Places API HTTP 403",
    });
    assert.ok(!health.detail.includes(FAKE_KEY));
  });

  test("a network failure is reported as unreachable instead of throwing", async () => {
    stubFetch(() => Promise.reject(new Error("getaddrinfo ENOTFOUND")));
    const health = await checkPlacesHealth(FAKE_KEY, "ChIJ_A");
    assert.equal(health.reachable, false);
    assert.equal(health.totalRatingCount, null);
    assert.match(health.detail, /unreachable: getaddrinfo ENOTFOUND/);
  });
});

describe("checkPlacesHealth feeding isScraperSilentlyBroken", () => {
  test("an empty scrape of a listing with ratings is flagged as broken", async () => {
    stubFetch(() => json({ userRatingCount: 42 }));
    assert.equal(
      isScraperSilentlyBroken(0, await checkPlacesHealth(FAKE_KEY, "p")),
      true,
    );
  });

  test("an API outage never accuses the scraper", async () => {
    stubFetch(() => json({}, 500));
    assert.equal(
      isScraperSilentlyBroken(0, await checkPlacesHealth(FAKE_KEY, "p")),
      false,
    );
  });
});
