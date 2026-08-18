import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Turns doc drift into a test failure.
 *
 * CLAUDE.md is loaded into every agent session, so a stale claim in it is not a
 * cosmetic problem: an agent reads it with the same confidence as code and acts
 * on it. This suite caught the layout block still naming `google.ts` months
 * after the file became `googleMaps.ts`, and describing `tests/fixtures/` as the
 * offline corpus while that directory had never held a tracked file.
 */
const ROOT = resolve(import.meta.dirname, "..");
const CLAUDE_MD = readFileSync(resolve(ROOT, "CLAUDE.md"), "utf8");

function layoutPaths(): string[] {
  const block = CLAUDE_MD.match(/## Layout\n[\s\S]*?```\n([\s\S]*?)```/);
  // Guard the guard: renaming the heading must not silently disable this test.
  assert.ok(block?.[1], "CLAUDE.md has no ## Layout code block to verify");

  return block[1]
    .split("\n")
    .filter((line) => line.trim() !== "")
    // Runtime state a fresh clone legitimately lacks.
    .filter((line) => !line.includes("(gitignored)"))
    .map((line) => line.trim().split(/\s+/)[0] ?? "");
}

describe("CLAUDE.md stays true", () => {
  test("every path in the Layout block exists", () => {
    const missing = layoutPaths().filter(
      (path) => !existsSync(resolve(ROOT, path)),
    );
    assert.deepEqual(
      missing,
      [],
      `CLAUDE.md documents paths that do not exist: ${missing.join(", ")}`,
    );
  });

  test("the Layout block is not empty", () => {
    assert.ok(layoutPaths().length > 5, "Layout block looks truncated");
  });

  test("tests/fixtures/ actually holds fixtures, as documented", () => {
    // The specific lie this suite was written for: a documented corpus that was
    // an empty directory.
    const entries = readdirSync(resolve(ROOT, "tests/fixtures"));
    assert.ok(
      entries.length > 0,
      "CLAUDE.md claims tests run over fixtures, but tests/fixtures/ is empty",
    );
  });
});
