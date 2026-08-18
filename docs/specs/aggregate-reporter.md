# Spec: Aggregate Reporter

## Goal

- Consume the local archive (`reviews.jsonl`) and produce the intelligence layer (pros/cons report).

## Entry Point

- ran by `npm run report`

## Behavior

- Reviews whose reviewDate falls in the report month.
- npm run report targets the current month if not specified by the --month=YYYY-MM flag following npm run.
- Map: Haiku extracts structured claims from each review, tagged with that review's ID
- Code lives in `src/report/`
- Reduce: Sonnet synthesizes claims into pros/cons, each citing the review IDs it came from.
- Judge: A temperature-0 pass checks every claim against its cited reviews.
- Write reports/{restaurant_name}/YYYY-MM.md
  For calling Haiku, and Sonnet use: {ANTHROPIC_API_KEY} via `process.env.ANTHROPIC_API_KEY`

## Rules

- If a claim is uncited, drop the claim.
- Writes the reviews of the month to `reports/{restaurant_name}/YYYY-MM.md`
- RecentRatingsTrajectory is computed in Code. Not by the LLM
- If it's the restaurant's first month OR prior month data is unavailable, simply show the ratings of this month.
- Slug Rules: lowercase; replace every run of non-alphanumeric characters with a single hyphen; trim leading/trailing hyphens.
  - Example: "Dr. DOOOM Lab" -> "dr-dooom-lab"

## Shapes

- input is `data/reviews.jsonl`
- `NormalizedReview {
source: ReviewSource;
/** restaurant name holds the display name as in `targets.json`*/
restaurantName: string;
/** Stable across runs. See`resolveIdCollisions`for the Yelp caveat. */
reviewId: string;
author: string;
/** 1-5. */
rating: number;
/** ISO-8601 UTC instant, or a YYYY-MM-DD day when that is all the source gives. */
reviewDate: string;
text: string;
/** Permalink to the review, or to the listing when the source has no permalink. */
url: string;
/** True when`text` is an excerpt rather than the full review (Yelp Fusion). */
truncated: boolean;
/** Absolute path to a captured PNG. Absent when enrichment was blocked. */
screenshotPath?: string;
}`
- ```

  ```

# Dr. DOOOM Lab — 2026-08

## Pros

- Generous portions, consistently praised [g_abc123, y_2024-11-02_ReviewerB]

## Cons

- Slow service on weekends [y_2024-11-09_ReviewerC]

## Recent Ratings Trajectory

- Ratings this month was 4.75. Ratings last month was 4.63

```

## Non-Goals
- No fetching, we only read the archive.
- No detector imports
- No touching `seen.json`

## Acceptance
- `npm test` green, no network.
- `npm run typecheck` clean.
- Golden set of ~20 redacted reviews in tests/fixtures/reviews, recorded Haiku/Sonnet judge responses as fixture.
```
