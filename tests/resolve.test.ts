import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { extractParsedInput, parseRestaurantInput } from "../src/resolve/parseInput.ts";
import {
  extractGoogleResolution,
  searchGooglePlace,
} from "../src/resolve/googleTextSearch.ts";
import {
  canonicalizeYelpUrl,
  extractYelpResolution,
  searchYelpBusiness,
} from "../src/resolve/yelpSearch.ts";
import {
  appendTarget,
  buildTarget,
  findDuplicate,
  readTargetsFile,
  type StoredTarget,
} from "../src/resolve/targetsFile.ts";
import type { HttpFetch, ResolvedTarget } from "../src/resolve/types.ts";

const FIXTURES = resolve(import.meta.dirname, "fixtures");
const anthropicFixture = JSON.parse(
  readFileSync(join(FIXTURES, "anthropic-parse-input.json"), "utf8"),
) as unknown;
const googleFixture = JSON.parse(
  readFileSync(join(FIXTURES, "google-places-textsearch.json"), "utf8"),
) as unknown;
const yelpFixture = JSON.parse(
  readFileSync(join(FIXTURES, "yelp-business-search.json"), "utf8"),
) as unknown;

function stubFetch(body: unknown, status = 200): HttpFetch {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

function target(partial: Partial<ResolvedTarget> = {}): ResolvedTarget {
  return {
    restaurantName: "Dr. DOOOM Lab",
    google: { mapsUrl: "https://maps.google.com/?cid=1", placeId: "ChIJ_A" },
    yelp: { businessUrl: "https://www.yelp.com/biz/dr-dooom-lab-canary-2" },
    ...partial,
  };
}

describe("extractParsedInput", () => {
  test("reads {name, location} out of the Messages API fixture", () => {
    assert.deepEqual(extractParsedInput(anthropicFixture), {
      name: "dr dooom lab",
      location: "canary",
    });
  });

  test("tolerates a code-fenced reply", () => {
    const body = {
      content: [{ type: "text", text: '```json\n{"name": "kfc", "location": ""}\n```' }],
    };
    assert.deepEqual(extractParsedInput(body), { name: "kfc", location: "" });
  });

  test("throws on a reply with no text block", () => {
    assert.throws(() => extractParsedInput({ content: [] }), /no text block/);
  });

  test("throws on a reply that is not JSON", () => {
    const body = { content: [{ type: "text", text: "Sure! The name is KFC." }] };
    assert.throws(() => extractParsedInput(body), /as JSON/);
  });

  test("throws when the reply has no name", () => {
    const body = { content: [{ type: "text", text: '{"location": "canary"}' }] };
    assert.throws(() => extractParsedInput(body), /no restaurant name/);
  });
});

describe("parseRestaurantInput", () => {
  test("resolves the fixture reply through the fetch wrapper, offline", async () => {
    const parsed = await parseRestaurantInput(
      "dr dooom lab canary",
      "test-key",
      stubFetch(anthropicFixture),
    );
    assert.deepEqual(parsed, { name: "dr dooom lab", location: "canary" });
  });

  test("reports an HTTP failure by status only", async () => {
    await assert.rejects(
      () => parseRestaurantInput("kfc", "test-key", stubFetch({}, 529)),
      /Anthropic API HTTP 529/,
    );
  });
});

describe("extractGoogleResolution", () => {
  test("takes the top relevance-ranked place from the fixture", () => {
    assert.deepEqual(extractGoogleResolution(googleFixture), {
      placeId: "ChIJREDACTEDREDACTED0001",
      mapsUrl: "https://maps.google.com/?cid=11111111111111111111",
      displayName: "Dr. DOOOM Lab",
    });
  });

  test("returns empty strings when nothing matched", () => {
    assert.deepEqual(extractGoogleResolution({}), {
      placeId: "",
      mapsUrl: "",
      displayName: "",
    });
    assert.equal(extractGoogleResolution({ places: [] }).placeId, "");
  });

  // Half-resolved Google entries could neither be scraped nor deduped, so a
  // place missing either field counts as not found.
  test("requires BOTH the id and the maps URL", () => {
    assert.equal(extractGoogleResolution({ places: [{ id: "ChIJ_X" }] }).placeId, "");
    assert.equal(
      extractGoogleResolution({ places: [{ googleMapsUri: "https://maps.google.com/?cid=9" }] })
        .mapsUrl,
      "",
    );
  });
});

describe("searchGooglePlace", () => {
  test("resolves via the injected fetch, offline", async () => {
    const result = await searchGooglePlace(
      "dr dooom lab",
      "canary",
      "test-key",
      stubFetch(googleFixture),
    );
    assert.equal(result.placeId, "ChIJREDACTEDREDACTED0001");
  });

  // Spec: a failing source is "unresolved", never a crash — the other source
  // must still be usable.
  test("an HTTP error yields unresolved, not a throw", async () => {
    const result = await searchGooglePlace("kfc", "", "test-key", stubFetch({}, 403));
    assert.deepEqual(result, { placeId: "", mapsUrl: "", displayName: "" });
  });

  test("a network failure yields unresolved, not a throw", async () => {
    const failing: HttpFetch = async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    const result = await searchGooglePlace("kfc", "", "test-key", failing);
    assert.equal(result.placeId, "");
  });
});

describe("extractYelpResolution / canonicalizeYelpUrl", () => {
  test("takes the top business and strips Fusion tracking params", () => {
    assert.deepEqual(extractYelpResolution(yelpFixture), {
      businessUrl: "https://www.yelp.com/biz/dr-dooom-lab-canary-2",
      name: "Dr. DOOOM Lab",
    });
  });

  test("returns empty strings when nothing matched", () => {
    assert.equal(extractYelpResolution({ businesses: [] }).businessUrl, "");
    assert.equal(extractYelpResolution({}).businessUrl, "");
  });

  test("canonicalization leaves a clean URL untouched", () => {
    assert.equal(
      canonicalizeYelpUrl("https://www.yelp.com/biz/dr-dooom-lab-canary-2"),
      "https://www.yelp.com/biz/dr-dooom-lab-canary-2",
    );
  });
});

describe("searchYelpBusiness", () => {
  test("resolves via the injected fetch, offline", async () => {
    const result = await searchYelpBusiness(
      "dr dooom lab",
      "canary",
      "test-key",
      stubFetch(yelpFixture),
    );
    assert.equal(result.businessUrl, "https://www.yelp.com/biz/dr-dooom-lab-canary-2");
  });

  // Fusion 400s without a location, so the call must not even be attempted.
  test("skips the network entirely when there is no location", async () => {
    let called = false;
    const spy: HttpFetch = async () => {
      called = true;
      return { ok: true, status: 200, json: async () => yelpFixture };
    };
    const result = await searchYelpBusiness("kfc", "  ", "test-key", spy);
    assert.equal(result.businessUrl, "");
    assert.equal(called, false);
  });

  test("an HTTP error yields unresolved, not a throw", async () => {
    const result = await searchYelpBusiness("kfc", "la", "test-key", stubFetch({}, 401));
    assert.deepEqual(result, { businessUrl: "", name: "" });
  });
});

describe("buildTarget", () => {
  const parsed = { name: "dr dooom lab", location: "canary" };
  const google = {
    placeId: "ChIJ_A",
    mapsUrl: "https://maps.google.com/?cid=1",
    displayName: "Dr. DOOOM Lab",
  };
  const yelp = {
    businessUrl: "https://www.yelp.com/biz/dr-dooom-lab-canary-2",
    name: "dr dooom lab SM",
  };

  test("prefers Google's official name, then Yelp's, then the parsed guess", () => {
    assert.equal(buildTarget(parsed, google, yelp).restaurantName, "Dr. DOOOM Lab");
    assert.equal(
      buildTarget(parsed, { ...google, displayName: "" }, yelp).restaurantName,
      "dr dooom lab SM",
    );
    assert.equal(
      buildTarget(parsed, { ...google, displayName: "" }, { ...yelp, name: "" })
        .restaurantName,
      "dr dooom lab",
    );
  });

  test("carries unresolved sources through as empty strings", () => {
    const built = buildTarget(parsed, { placeId: "", mapsUrl: "", displayName: "" }, yelp);
    assert.equal(built.google.placeId, "");
    assert.equal(built.google.mapsUrl, "");
    assert.equal(built.yelp.businessUrl, yelp.businessUrl);
  });
});

describe("findDuplicate", () => {
  const existing: StoredTarget[] = [
    {
      restaurantName: "Dr. DOOOM Lab",
      google: { mapsUrl: "https://maps.google.com/?cid=1", placeId: "ChIJ_A" },
      yelp: { businessUrl: "https://www.yelp.com/biz/dr-dooom-lab-canary-2" },
    },
    {
      restaurantName: "KFC",
      google: { mapsUrl: "https://maps.google.com/?cid=2", placeId: "ChIJ_B" },
      yelp: { businessUrl: "" },
    },
  ];

  test("matches on placeId", () => {
    const dup = findDuplicate(existing, target({ yelp: { businessUrl: "" } }));
    assert.match(dup ?? "", /placeId ChIJ_A/);
  });

  test("matches on Yelp businessUrl", () => {
    const dup = findDuplicate(
      existing,
      target({ google: { mapsUrl: "", placeId: "" } }),
    );
    assert.match(dup ?? "", /dr-dooom-lab-canary-2/);
  });

  test("matches a stored URL that still carries tracking params", () => {
    const stored: StoredTarget[] = [
      {
        restaurantName: "Dr. DOOOM Lab",
        yelp: {
          businessUrl:
            "https://www.yelp.com/biz/dr-dooom-lab-canary-2?adjust_creative=X",
        },
      },
    ];
    assert.ok(findDuplicate(stored, target({ google: { mapsUrl: "", placeId: "" } })));
  });

  // Spec: empty strings never count as a match — two Google-only targets both
  // have businessUrl "" and must not collide.
  test("empty strings never match each other", () => {
    const candidate = target({
      restaurantName: "Burger King",
      google: { mapsUrl: "", placeId: "" },
      yelp: { businessUrl: "https://www.yelp.com/biz/burgerking-canary-2" },
    });
    assert.equal(findDuplicate(existing, candidate), null);
  });

  test("a genuinely new place is not a duplicate", () => {
    const candidate = target({
      google: { mapsUrl: "https://maps.google.com/?cid=9", placeId: "ChIJ_Z" },
      yelp: { businessUrl: "https://www.yelp.com/biz/somewhere-else" },
    });
    assert.equal(findDuplicate(existing, candidate), null);
  });
});

describe("targets file round trip", () => {
  let dir: string;
  const created: string[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "restaurants-targets-"));
    created.push(dir);
  });

  after(async () => {
    await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
  });

  test("a missing file reads as an empty list, so the first append works", async () => {
    assert.deepEqual(await readTargetsFile(join(dir, "nope.json")), []);
  });

  test("refuses a non-array file instead of clobbering it", async () => {
    const path = join(dir, "targets.json");
    await writeFile(path, '{"restaurantName": "KFC"}', "utf8");
    await assert.rejects(() => readTargetsFile(path), /ARRAY/);
  });

  test("append preserves existing entries and the new one survives a re-read", async () => {
    const path = join(dir, "targets.json");
    const first = target();
    await appendTarget(path, [], first);
    const second = target({
      restaurantName: "Burger King",
      google: { mapsUrl: "", placeId: "" },
      yelp: { businessUrl: "https://www.yelp.com/biz/burgerking-canary-2" },
    });
    const afterFirst = await readTargetsFile(path);
    await appendTarget(path, afterFirst, second);

    const all = await readTargetsFile(path);
    assert.equal(all.length, 2);
    assert.deepEqual(all[0], first);
    assert.deepEqual(all[1], second);
    // The file stays valid JSON with a trailing newline.
    const raw = await readFile(path, "utf8");
    assert.ok(raw.endsWith("\n"));
  });

  test("re-resolving an appended target is caught as a duplicate", async () => {
    const path = join(dir, "targets.json");
    await appendTarget(path, [], target());
    const reread = await readTargetsFile(path);
    assert.ok(findDuplicate(reread, target()));
  });
});
