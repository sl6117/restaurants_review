# restaurants_review

Restaurant review intelligence with a search bar. Type a restaurant's name and get its current ratings, an overall review summary covering the past 6 months, the menu items reviewers mention most, and any should-knows - built from that restaurant's **Google Maps** and **Yelp** reviews.

## Rules

1. **Tests never hit the network.** A test that calls Google or Yelp is a bug.
   Add a fixture to `tests/fixtures/` instead.
2. **Run `npm test` before reporting done.** The Stop hook enforces this, but
   don't make it do the work.
3. **Never read or print `.env` or `credentials/`.** Both are deny-listed. Code
   uses `process.env.*`; secrets never reach logs, fixtures, or the doc.
4. **Redact fixtures** — no API keys, no real reviewer names.
5. **Dedupe correctness outranks everything.** A duplicate row means the project owner
   stops trusting the doc. After any change to ID derivation or a parser,
   re-run `npm run check` twice and confirm the second run appends zero rows.
6. **Commit after each working step**, so any change is one `git checkout` from
   being undone.
7. **Nothing outside this directory** gets created, edited, or deleted without
   asking the project owner first. The one known exception is the launchd plist at
   `~/Library/LaunchAgents/com.example.reviews.plist` — ask before installing.

## Layout

Every path below is asserted to exist by `tests/docs.test.ts`, so this block
cannot rot into fiction. Lines marked `(gitignored)` are skipped — they are
runtime state a fresh clone will not have.

```
config/targets.json          Google Maps + Yelp URLs and place IDs (gitignored)
src/sources/googleMaps.ts    scrape -> NormalizedReview[] (detection)
src/sources/googlePlaces.ts  Places API health check, NOT a detector
src/sources/yelp.ts          scrape -> NormalizedReview[] (detection)
src/enrich/screenshot.ts     Playwright, real Chrome, timeout-guarded
src/store/seen.ts            dedupe ledger
src/store/doc.ts             Docs append
src/store/drive.ts           image upload
src/store/googleAuth.ts      OAuth
src/normalize.ts             shared shape + stable review IDs
src/resolve/addRestaurant.ts CLI: free text -> resolved target appended to targets.json
src/resolve/parseInput.ts    Haiku splits the query into {name, location}
src/resolve/googleTextSearch.ts  Places Text Search -> placeId + mapsUrl
src/resolve/yelpSearch.ts    Yelp Fusion business search -> businessUrl (no scraping)
src/resolve/targetsFile.ts   read + dedupe + append config/targets.json
src/run.ts                   orchestrator, supports --dry-run
src/report/                  aggregate reporter: map (Haiku) -> reduce (Sonnet) -> judge
src/report/run.ts            reporter CLI, supports --month=YYYY-MM
tests/fixtures/              redacted HTML/API payloads — tests run offline
tests/fixtures/reviews/      golden archive + recorded Haiku/Sonnet replies
data/seen.json               dedupe state (gitignored)
data/reviews.jsonl           append-only review archive (gitignored)
reports/                     generated {restaurant-slug}/YYYY-MM.md (gitignored)
```

## Commands

- `npm test` — offline unit tests over fixtures. No network, ever.
- `npm run check -- --dry-run` — live fetch, prints rows, writes nothing.
- `npm run check` — real run.
- `npm run report` — pros/cons report from the archive for the current month; `npm run report -- --month=YYYY-MM` for a past month. Needs `ANTHROPIC_API_KEY`.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run add-restaurant -- "name city"` — resolve a restaurant via Google
  Places Text Search + Yelp Fusion and append it to `config/targets.json`.
  Needs `ANTHROPIC_API_KEY`, plus `GOOGLE_MAPS_API_KEY` and/or `YELP_API_KEY`.
  In a target, an empty string means that source did not resolve; the run
  skips empty-URL sources.

## Dedupe keys
- **Google** — uses the API's review resource `name`, which is stable. Trust it.
- **Yelp** — exposes no stable ID. Primary key is `author + reviewDate`, with a hash of the first 80 characters of text only as a tiebreaker for the same author reviewing twice on one day.

Text is delierately *not* part of the primary key: if it were, a reviewer editing their review would resurface it as new.
