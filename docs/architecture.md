## Architecture: one detector per source, plus an API health check

This is the load-bearing decision in the project. Do not undo it.

| Layer | Job | On failure |
| --- | --- | --- |
| **Detection** — `src/sources/*Maps.ts`, `*/yelp.ts` | Decide *that* a review is new, plus its core fields | Fail loudly, non-zero exit |
| **Health check** — `src/sources/googlePlaces.ts` | Independently confirm the detector isn't silently broken | Fail loudly |
| **Enrichment** — `src/enrich/screenshot.ts` | Full text + PNG of the review card | Warn, write the row anyway |

### Why the API is a health check and not a second detector

`reviews_sort=newest` exists only on the **legacy** Places API, which Google no
longer onboards new Cloud projects to. Places API **(New)** — the only one a
fresh project can use — accepts just `languageCode`, `regionCode`, and
`sessionToken`, and returns 5 reviews ordered by *relevance*. A brand-new review
may simply not be among them, so it cannot be trusted for detection.

The tempting fix is to append the union of scrape + API results. **Do not.** The
two paths derive review IDs differently, so the same review would land in the
doc twice. Instead the API answers one question: *did the scraper return zero
reviews while the API can see reviews?* If so, the scraper is broken — exit
non-zero and alert. Same recall benefit, no duplicate risk.

Yelp is behind PerimeterX, so browser automation there **will** be blocked
eventually. That must degrade to a row without a screenshot, never to a missed
review.

**When a scraper breaks, never respond by adding stealth plugins, proxies, or
CAPTCHA solvers.** Report it to the project owner. One request per day is what keeps this
defensible.


## Why OAuth, and why exactly one scope

The Docs API cannot accept image bytes — `insertInlineImage` takes a URL and
fetches it server-side. So every screenshot must be uploaded to Drive and made
link-readable first. Service accounts have no Drive storage quota of their own,
and the standard workaround (a Shared Drive) needs Google Workspace, which a
personal Gmail does not have. Hence OAuth as project ownser, via `npm run authorize`.

The only scope requested is `drive.file`. **Do not add `documents`.** It means
"see, edit, create and delete all your Google Docs", is classified sensitive,
and forces app verification plus an "unverified app" warning — which is what
blocked setup the first time round. `drive.file` covers only files this app
created, which is why `resolveDocument()` in run.ts creates the doc itself and
persists the id to `data/document.json`. Losing that file means the next run
silently starts a SECOND doc and splits the review history.

Two more consequences worth remembering:

- A consent screen left in "Testing" expires refresh tokens after 7 days. The
  daily run then dies silently. If auth mysteriously breaks about a week after
  setup, this is why.
- `insertInlineImage` fails the WHOLE batchUpdate if it cannot fetch a URL,
  which would drop the text of every review in that run, not just one image.
  `hostImage()` in run.ts therefore probes each candidate URL before using it,
  and falls back to no image rather than risking the batch.


  ## Dedupe: how review IDs are derived

- **Google** — uses the API's review resource `name`, which is stable. Trust it.
- **Yelp** — exposes no stable ID. Primary key is `author + reviewDate`, with a
  hash of the first 80 characters of text only as a tiebreaker for the same
  author reviewing twice on one day.

Text is deliberately *not* part of the primary key: if it were, a reviewer
editing their review would resurface it as new.