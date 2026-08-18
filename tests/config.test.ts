import { test, describe, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv, loadTargets, type Target } from "../src/config.ts";

const KEYS = [
  "GOOGLE_DOC_ID",
  "GOOGLE_MAPS_API_KEY",
  "GOOGLE_OAUTH_CLIENT",
  "GOOGLE_OAUTH_TOKEN",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("loadEnv", () => {
  // Regression: loadEnv required GOOGLE_DOC_ID after the design changed to
  // creating the doc on first run, so a correctly-configured .env still aborted
  // with "Missing GOOGLE_DOC_ID". Nothing offline covered it.
  test("does not require GOOGLE_DOC_ID", () => {
    assert.doesNotThrow(() => loadEnv());
    assert.equal(loadEnv().documentId, "");
  });

  test("passes GOOGLE_DOC_ID through when set as an override", () => {
    process.env["GOOGLE_DOC_ID"] = "DOC123";
    assert.equal(loadEnv().documentId, "DOC123");
  });

  test("reports a missing API key as null rather than an empty string", () => {
    assert.equal(loadEnv().googleMapsApiKey, null);
  });

  test("resolves credential paths to absolute locations", () => {
    const env = loadEnv();
    assert.ok(env.oauthClientPath.startsWith("/"));
    assert.ok(env.oauthClientPath.endsWith("credentials/oauth-client.json"));
    assert.ok(env.oauthTokenPath.endsWith("credentials/token.json"));
  });
});

describe("loadTargets", () => {
  let dir: string;
  const created: string[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "restaurants-config-"));
    created.push(dir);
  });

  after(async () => {
    await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
  });

  async function load(targets: unknown): Promise<Target[]> {
    const path = join(dir, "targets.json");
    await writeFile(path, JSON.stringify(targets), "utf8");
    return loadTargets(path);
  }

  function entry(google: { mapsUrl: string; placeId?: string }, businessUrl: string) {
    return { restaurantName: "KFC", google, yelp: { businessUrl } };
  }

  // The dynamic-targets resolver stores an empty string for a source that did
  // not resolve, so a one-source target must load.
  test("accepts a Google-only target", async () => {
    const [target] = await load([
      entry({ mapsUrl: "https://maps.google.com/?cid=1", placeId: "ChIJ_A" }, ""),
    ]);
    assert.equal(target!.yelp.businessUrl, "");
    assert.equal(target!.google.mapsUrl, "https://maps.google.com/?cid=1");
  });

  test("accepts a Yelp-only target", async () => {
    const [target] = await load([
      entry({ mapsUrl: "" }, "https://www.yelp.com/biz/kfc-canary"),
    ]);
    assert.equal(target!.google.mapsUrl, "");
    assert.equal(target!.yelp.businessUrl, "https://www.yelp.com/biz/kfc-canary");
  });

  test("rejects a target with neither source", async () => {
    await assert.rejects(() => load([entry({ mapsUrl: "" }, "")]), /neither/);
  });

  test("still rejects placeholder URLs", async () => {
    await assert.rejects(
      () => load([entry({ mapsUrl: "https://www.google.com/maps/place/..." }, "")]),
      /placeholder/,
    );
    await assert.rejects(
      () => load([entry({ mapsUrl: "" }, "https://www.yelp.com/biz/...")]),
      /placeholder/,
    );
  });
});
