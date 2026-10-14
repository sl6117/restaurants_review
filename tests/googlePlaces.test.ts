import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  checkPlacesHealth,
  isScraperSilentlyBroken,
} from "../src/sources/googlePlaces.ts";
import type { HttpFetch } from "../src/resolve/types.ts";

const FAKE_KEY = "TEST_KEY_not_real";

interface Captured {
  url: string;
  headers: Record<string, string>;
}

function stubFetch(body: unknown, status = 200, calls: Captured[] = []): HttpFetch {
  return async (url, init) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
}

describe("checkPlacesHealth", () => {
  test("asks Places for the rating count with the key in a header, not the URL", async () => {
    const calls: Captured[] = [];
    await checkPlacesHealth(
      FAKE_KEY,
      "ChIJ/odd id",
      stubFetch({ userRatingCount: 7 }, 200, calls),
    );

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0]!.url,
      "https://places.googleapis.com/v1/places/ChIJ%2Fodd%20id",
    );
    assert.equal(calls[0]!.headers["X-Goog-Api-Key"], FAKE_KEY);
    assert.match(calls[0]!.headers["X-Goog-FieldMask"]!, /userRatingCount/);
    assert.ok(!calls[0]!.url.includes(FAKE_KEY));
  });

  test("reports the listing's rating count when reachable", async () => {
    const fetchFn = stubFetch({ id: "ChIJ_A", userRatingCount: 42 });
    assert.deepEqual(await checkPlacesHealth(FAKE_KEY, "ChIJ_A", fetchFn), {
      reachable: true,
      totalRatingCount: 42,
      detail: "Places API reports 42 ratings",
    });
  });

  test("treats a listing with no userRatingCount as zero ratings", async () => {
    const health = await checkPlacesHealth(
      FAKE_KEY,
      "ChIJ_A",
      stubFetch({ id: "ChIJ_A" }),
    );
    assert.equal(health.reachable, true);
    assert.equal(health.totalRatingCount, 0);
  });

  test("an HTTP error is unreachable and never echoes the response body", async () => {
    const fetchFn = stubFetch(
      { error: { message: `API key ${FAKE_KEY} not valid` } },
      403,
    );
    const health = await checkPlacesHealth(FAKE_KEY, "ChIJ_A", fetchFn);
    assert.deepEqual(health, {
      reachable: false,
      totalRatingCount: null,
      detail: "Places API HTTP 403",
    });
    assert.ok(!health.detail.includes(FAKE_KEY));
  });

  test("a network failure is reported as unreachable instead of throwing", async () => {
    const fetchFn: HttpFetch = async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    const health = await checkPlacesHealth(FAKE_KEY, "ChIJ_A", fetchFn);
    assert.equal(health.reachable, false);
    assert.equal(health.totalRatingCount, null);
    assert.match(health.detail, /unreachable: getaddrinfo ENOTFOUND/);
  });
});

describe("checkPlacesHealth feeding isScraperSilentlyBroken", () => {
  test("an empty scrape of a listing with ratings is flagged as broken", async () => {
    const health = await checkPlacesHealth(
      FAKE_KEY,
      "p",
      stubFetch({ userRatingCount: 42 }),
    );
    assert.equal(isScraperSilentlyBroken(0, health), true);
  });

  test("an API outage never accuses the scraper", async () => {
    const health = await checkPlacesHealth(FAKE_KEY, "p", stubFetch({}, 500));
    assert.equal(isScraperSilentlyBroken(0, health), false);
  });
});
