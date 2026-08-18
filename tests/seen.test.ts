import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadLedger,
  saveLedger,
  selectNew,
  withRecorded,
  type SeenLedger,
} from "../src/store/seen.ts";
import type { NormalizedReview } from "../src/normalize.ts";

let dir: string;
const created: string[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "restaurants-seen-"));
  created.push(dir);
});

after(async () => {
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});

function review(id: string): NormalizedReview {
  return {
    source: "google",
    reviewId: id,
    author: "A",
    rating: 5,
    reviewDate: "2026-07-28",
    text: "t",
    url: "u",
    truncated: false,
  };
}

describe("loadLedger", () => {
  test("treats a missing file as an empty ledger", async () => {
    const ledger = await loadLedger(join(dir, "nope.json"));
    assert.deepEqual(ledger.ids, []);
    assert.equal(ledger.lastRunAt, null);
  });

  // Silently resetting to empty would re-append every review to the sheet.
  test("refuses to run on corrupt JSON instead of resetting", async () => {
    const path = join(dir, "seen.json");
    await writeFile(path, '{"version":1,"ids":["a"', "utf8");
    await assert.rejects(() => loadLedger(path), /not valid JSON/);
  });

  test("refuses a ledger with no ids array", async () => {
    const path = join(dir, "seen.json");
    await writeFile(path, '{"version":1}', "utf8");
    await assert.rejects(() => loadLedger(path), /missing its "ids" array/);
  });

  test("drops non-string entries defensively", async () => {
    const path = join(dir, "seen.json");
    await writeFile(
      path,
      '{"version":1,"lastRunAt":null,"ids":["a",null,7,"b"]}',
      "utf8",
    );
    assert.deepEqual((await loadLedger(path)).ids, ["a", "b"]);
  });
});

describe("selectNew", () => {
  const ledger: SeenLedger = { version: 1, lastRunAt: null, ids: ["google:seen"] };

  test("keeps only unseen reviews", () => {
    const out = selectNew([review("google:seen"), review("google:fresh")], ledger);
    assert.deepEqual(
      out.map((r) => r.reviewId),
      ["google:fresh"],
    );
  });

  test("collapses a duplicate id appearing twice in one batch", () => {
    const out = selectNew([review("google:dup"), review("google:dup")], ledger);
    assert.equal(out.length, 1);
  });

  test("returns nothing when every review is already seen", () => {
    assert.deepEqual(selectNew([review("google:seen")], ledger), []);
  });
});

describe("saveLedger round-trip", () => {
  test("persists recorded ids and survives a reload", async () => {
    const path = join(dir, "seen.json");
    const start = await loadLedger(path);
    const next = withRecorded(start, [review("google:a"), review("google:b")]);
    await saveLedger(path, next, "2026-07-30T09:00:00.000Z");

    const reloaded = await loadLedger(path);
    assert.deepEqual(reloaded.ids, ["google:a", "google:b"]);
    assert.equal(reloaded.lastRunAt, "2026-07-30T09:00:00.000Z");
  });

  test("deduplicates ids on write", async () => {
    const path = join(dir, "seen.json");
    await saveLedger(
      path,
      { version: 1, lastRunAt: null, ids: ["x", "x", "y"] },
      "2026-07-30T09:00:00.000Z",
    );
    assert.deepEqual((await loadLedger(path)).ids, ["x", "y"]);
  });

  test("leaves no .tmp file behind", async () => {
    const path = join(dir, "seen.json");
    await saveLedger(
      path,
      { version: 1, lastRunAt: null, ids: ["x"] },
      "2026-07-30T09:00:00.000Z",
    );
    await assert.rejects(() => readFile(`${path}.tmp`, "utf8"), /ENOENT/);
  });
});

// The end-to-end property the whole project depends on: run twice, append once.
describe("two consecutive runs", () => {
  test("the second run finds nothing new", async () => {
    const path = join(dir, "seen.json");
    const batch = [review("google:a"), review("google:b")];

    const first = await loadLedger(path);
    const firstNew = selectNew(batch, first);
    assert.equal(firstNew.length, 2);
    await saveLedger(path, withRecorded(first, firstNew), "2026-07-30T09:00:00.000Z");

    const second = await loadLedger(path);
    assert.deepEqual(selectNew(batch, second), []);
  });
});
