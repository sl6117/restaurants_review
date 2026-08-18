# Handoff — 2026-07-30 evening

Next checkpoint: the **09:00 run on 2026-07-31**. Open a session and say
"check the logs".

## State

**The scheduled job works.** This is the first verified-by-artifact proof. After
`launchctl bootout` + `bootstrap` (plain `load` silently no-ops on an
already-bootstrapped job, so the edited plist was never picked up), `logs/run.log`
showed:

```
Checking reviews for <the restaurant>
  google: 20 review(s) visible
Found 20 review(s) across sources; 0 new.
```

with no `> restaurants-review@1.0.0 check` banner. That absence is the proof — the
plist invokes node directly, so npm cannot appear in output launchd produced.
No `bad option` (right Node), no `getcwd` (Desktop permission wall gone).

**Yelp failed in that same run** — `Yelp returned no review elements`, run exited
non-zero. It had returned 10 reviews 25 minutes earlier. The listing was hit 3×
that day (11:58 capture, 18:20 manual check, 18:45 launchd). Soft block is far
more likely than a markup change in a 25-minute window.

**Google double-count fixed** (commit `bafb607`). `div[data-review-id]` matched
both the outer card and a nested element with the same id, so every review was
counted twice. No duplicate ever reached the doc — `selectNew` collapsed them —
but the duplicates were counted before `.slice(0, 20)`, making the real ceiling
10 reviews, and they doubled the log's "N review(s) visible".

## Tomorrow

1. Read `logs/run.log` and `logs/run.error.log`. Both were truncated at 18:44,
   so anything present is from the 09:00 run.
2. **Expect `google: 10 review(s) visible`, not 20.** The halving is the fix
   landing, not a regression. `Found` should be 20 if Yelp recovers, 10 if not.
3. Yelp decides the next move:
   - **Returns reviews** → it was a soft block from same-day traffic. Nothing to
     fix. Note it and move on.
   - **Still empty**, on a day with a single request → markup change. Now
     `/fix-scrape` is diagnostic rather than noise. Run it.

   Do not run `/fix-scrape` before that run. It spends another request into a
   listing that is probably rate-limiting, and it destroys the clean test.

## Deferred, deliberately

**Rule 5's two live `npm run check` runs have NOT been done for the parser
change.** Running them today would have hit Yelp twice more and burned the
diagnostic above. The offline substitute is in place: `tests/googleMaps.test.ts`
pins one-row-per-review against a fixture that reproduces the nesting, and it was
verified by reverting the filter and watching it fail. Do the two live runs after
tomorrow's 09:00 result is in hand.

**One thing to watch:** the fix restores the intended 20-review ceiling. If Maps
renders more than 10 cards, reviews at positions 11+ are genuine reviews that
were previously never captured — they will append as "new" even though they are
old, because sorting is Newest-first. That is correct backfill, not a dedupe bug.
If a batch of older reviews lands in the doc, this is why. Ledger currently holds
20 ids (10 google, 10 yelp).

## Also changed

`tests/docs.test.ts` makes CLAUDE.md drift a test failure. The Layout block had
named `google.ts` for `googleMaps.ts` and described `tests/fixtures/` as the
offline corpus while that directory had never held a tracked file — which an
agent then repeated back as fact. Every documented path is now asserted to exist.

## Not done (proposed, not built)

- SessionStart hook injecting last-run state so a session opens with ground truth.
- Narrowing `"Bash(launchctl:*)"` in `.claude/settings.json` to deny only the
  mutating subcommands, so read-only `list`/`print` diagnosis is possible.
