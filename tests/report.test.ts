import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  filterMonth,
  groupByRestaurant,
  monthOf,
  previousMonth,
  readArchive,
  type ArchivedReview,
} from "../src/report/archive.ts";
import { reportPath, resolveMonth } from "../src/report/cli.ts";
import {
  extractJson,
  HAIKU_MODEL,
  SONNET_MODEL,
  type Complete,
  type CompletionRequest,
} from "../src/report/client.ts";
import { parseExtractResponse } from "../src/report/extract.ts";
import { parseJudgeResponse } from "../src/report/judge.ts";
import { buildReport } from "../src/report/report.ts";
import { dropUncited } from "../src/report/synthesize.ts";
import { formatTrajectory, meanRating } from "../src/report/trajectory.ts";

const FIXTURES = resolve(import.meta.dirname, "fixtures/reviews");
const ARCHIVE_PATH = join(FIXTURES, "archive.jsonl");

const extractReplies: Record<string, string> = JSON.parse(
  readFileSync(join(FIXTURES, "haiku-extract.json"), "utf8"),
);
const synthesizeReplies: Record<string, string> = JSON.parse(
  readFileSync(join(FIXTURES, "sonnet-synthesize.json"), "utf8"),
);
const judgeReplies: Record<string, string> = JSON.parse(
  readFileSync(join(FIXTURES, "sonnet-judge.json"), "utf8"),
);

let archive: ArchivedReview[];
before(async () => {
  archive = await readArchive(ARCHIVE_PATH);
});

/**
 * Replays the recorded Haiku/Sonnet fixtures. Any request it cannot match to
 * a recording throws — which is also the suite's no-network guarantee: an
 * unexpected model call fails the test instead of reaching for the API.
 */
const replayCompleter: Complete = async (request: CompletionRequest) => {
  if (request.model === HAIKU_MODEL) {
    const review = archive.find((r) => request.user.includes(r.text));
    const reply = review && extractReplies[review.reviewId];
    if (!reply) throw new Error(`No recorded extract reply for: ${request.user}`);
    return reply;
  }
  assert.equal(request.model, SONNET_MODEL);
  const claimMatch = request.user.match(/^Claim: (.*)$/m);
  if (claimMatch) {
    assert.equal(request.temperature, 0, "judge pass must run at temperature 0");
    const reply = judgeReplies[claimMatch[1]!];
    if (!reply) throw new Error(`No recorded judge reply for: ${claimMatch[1]}`);
    return reply;
  }
  const nameMatch = request.user.match(/^Restaurant: (.*)$/m);
  const reply = nameMatch && synthesizeReplies[nameMatch[1]!];
  if (!reply) throw new Error(`No recorded synthesis reply for: ${request.user}`);
  return reply;
};

describe("archive", () => {
  test("reads the golden set", () => {
    assert.equal(archive.length, 20);
  });

  test("filters by UTC month across instant and day-only dates", () => {
    assert.equal(monthOf(archive[0]!), "2026-08");
    assert.equal(filterMonth(archive, "2026-08").length, 12);
    assert.equal(filterMonth(archive, "2026-07").length, 8);
    assert.equal(filterMonth(archive, "2026-06").length, 0);
  });

  test("groups by restaurant display name", () => {
    const groups = groupByRestaurant(archive);
    assert.deepEqual(
      [...groups.keys()].sort(),
      ["Blue Karaage Bar", "Dr. DOOOM Lab"],
    );
    assert.equal(groups.get("Dr. DOOOM Lab")!.length, 16);
    assert.equal(groups.get("Blue Karaage Bar")!.length, 4);
  });

  test("rejects a corrupt line instead of skipping it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "restaurants-report-"));
    try {
      const path = join(dir, "bad.jsonl");
      await writeFile(path, '{"restaurantName":"X"\n', "utf8");
      await assert.rejects(() => readArchive(path), /not valid JSON/);
      await writeFile(path, '{"restaurantName":"X"}\n', "utf8");
      await assert.rejects(() => readArchive(path), /not an archived review/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("previousMonth wraps the year boundary", () => {
    assert.equal(previousMonth("2026-08"), "2026-07");
    assert.equal(previousMonth("2026-01"), "2025-12");
    assert.throws(() => previousMonth("2026-8"), /YYYY-MM/);
  });
});

describe("CLI arguments", () => {
  const now = new Date("2026-08-17T09:00:00.000Z");

  test("defaults to the current UTC month", () => {
    assert.equal(resolveMonth([], now), "2026-08");
  });

  test("honours --month=YYYY-MM", () => {
    assert.equal(resolveMonth(["--month=2026-05"], now), "2026-05");
  });

  test("rejects a malformed month", () => {
    assert.throws(() => resolveMonth(["--month=2026-13"], now), /YYYY-MM/);
    assert.throws(() => resolveMonth(["--month=aug"], now), /YYYY-MM/);
  });

  test("reportPath applies the slug rules", () => {
    assert.equal(
      reportPath("/root", "Dr. DOOOM Lab", "2026-08"),
      "/root/reports/dr-dooom-lab/2026-08.md",
    );
  });
});

describe("trajectory (computed in code)", () => {
  test("means match the golden set", () => {
    const house = groupByRestaurant(archive).get("Dr. DOOOM Lab")!;
    assert.equal(meanRating(filterMonth(house, "2026-08")), 4.75);
    assert.equal(meanRating(filterMonth(house, "2026-07")), 4.625);
  });

  test("formats both-months and first-month cases", () => {
    assert.equal(
      formatTrajectory(4.75, 4.625),
      "Ratings this month was 4.75. Ratings last month was 4.63",
    );
    assert.equal(formatTrajectory(4, null), "Ratings this month was 4.00.");
  });
});

describe("model reply parsing", () => {
  test("extractJson tolerates code fences and surrounding prose", () => {
    assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
    assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(extractJson('Sure, here it is: {"a":1}'), { a: 1 });
    assert.throws(() => extractJson("no json here"), /no JSON object/);
  });

  test("parseExtractResponse tags claims with the review ID in code", () => {
    const claims = parseExtractResponse(
      '{"claims":[{"sentiment":"pro","text":"Good"},{"sentiment":"meh","text":"x"},{"sentiment":"con","text":""}]}',
      "id-1",
    );
    assert.deepEqual(claims, [{ reviewId: "id-1", sentiment: "pro", text: "Good" }]);
    assert.throws(() => parseExtractResponse('{"nope":true}', "id-1"), /"claims"/);
  });

  test("parseJudgeResponse requires a boolean verdict", () => {
    assert.equal(parseJudgeResponse('{"supported":true}'), true);
    assert.equal(parseJudgeResponse('{"supported":false}'), false);
    assert.throws(() => parseJudgeResponse('{"supported":"yes"}'), /boolean/);
  });

  test("dropUncited removes empty and hallucinated citations", () => {
    const cleaned = dropUncited(
      {
        pros: [
          { text: "kept", citations: ["known", "invented"] },
          { text: "uncited", citations: [] },
          { text: "hallucinated", citations: ["invented"] },
        ],
        cons: [],
      },
      new Set(["known"]),
    );
    assert.deepEqual(cleaned.pros, [{ text: "kept", citations: ["known"] }]);
  });
});

describe("buildReport over the golden set", () => {
  test("Dr. DOOOM Lab renders the full report and drops bad claims", async () => {
    const house = groupByRestaurant(archive).get("Dr. DOOOM Lab")!;
    const markdown = await buildReport({
      restaurantName: "Dr. DOOOM Lab",
      month: "2026-08",
      reviews: filterMonth(house, "2026-08"),
      priorMonthReviews: filterMonth(house, "2026-07"),
      complete: replayCompleter,
    });

    assert.equal(
      markdown,
      [
        "# Dr. DOOOM Lab — 2026-08",
        "",
        "## Pros",
        "- Generous portions, consistently praised [dr-dooom-lab:google:g-aug-01, dr-dooom-lab:google:g-aug-02, dr-dooom-lab:yelp:reviewer-c:2026-08-07, dr-dooom-lab:google:g-aug-05]",
        "- Friendly staff and quick weekday lunch service [dr-dooom-lab:google:g-aug-03]",
        "",
        "## Cons",
        "- Slow service on weekends [dr-dooom-lab:yelp:reviewer-e:2026-08-10, dr-dooom-lab:yelp:reviewer-g:2026-08-15]",
        "",
        "## Recent Ratings Trajectory",
        "- Ratings this month was 4.75. Ratings last month was 4.63",
        "",
      ].join("\n"),
    );

    // The three drop rules, stated explicitly:
    assert.ok(!markdown.includes("Excellent value"), "uncited claim must be dropped");
    assert.ok(!markdown.includes("cocktail"), "hallucinated-citation claim must be dropped");
    assert.ok(!markdown.includes("g-nonexistent"), "invented ID must never be printed");
    assert.ok(!markdown.includes("Music is too loud"), "judge-rejected claim must be dropped");
  });

  test("a first-month restaurant shows only this month's rating", async () => {
    const bar = groupByRestaurant(archive).get("Blue Karaage Bar")!;
    const markdown = await buildReport({
      restaurantName: "Blue Karaage Bar",
      month: "2026-08",
      reviews: filterMonth(bar, "2026-08"),
      priorMonthReviews: filterMonth(bar, "2026-07"),
      complete: replayCompleter,
    });

    assert.ok(markdown.startsWith("# Blue Karaage Bar — 2026-08\n"));
    assert.ok(markdown.includes("- Ratings this month was 4.00.\n"));
    assert.ok(!markdown.includes("last month"), "no prior month → no trajectory comparison");
    assert.ok(
      markdown.includes(
        "- Long waits for food [blue-karaage-bar:yelp:reviewer-v:2026-08-14]",
      ),
    );
  });
});
