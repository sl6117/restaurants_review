---
description: Re-capture live API responses and page HTML into tests/fixtures/
---

Refresh the offline test fixtures so tests keep reflecting reality.

1. Capture the current Google Places API response to
   `tests/fixtures/google-places-<YYYY-MM-DD>.json`.
2. Capture the current Yelp source payload to
   `tests/fixtures/yelp-<YYYY-MM-DD>.{json,html}`.
3. **Redact before saving**: strip API keys, and replace reviewer names with
   `Reviewer A/B/C`. Fixtures are committed to git; real reviewer names and
   secrets must never land there.
4. Run `npm test` and report any parser that broke against the new fixtures.

Add new fixtures alongside the old ones — never overwrite. The value of a
fixture set is that it covers past shapes as well as the current one.
