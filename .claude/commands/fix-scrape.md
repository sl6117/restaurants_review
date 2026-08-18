---
description: Diagnose and repair a broken scraper/selector, then prove the fix with a test
---

A source has stopped returning reviews. Work through this in order and do not
skip to editing selectors.

1. **Reproduce and classify.** Run `npm run check -- --dry-run`. Decide which
   failure this is, because the fixes are completely different:
   - **Blocked** — CAPTCHA, 403, "unusual traffic", or an interstitial page.
     Selectors are fine. Do not touch them.
   - **DOM changed** — page loads, content is there, selectors match nothing.
   - **Empty** — page loads fine and there genuinely are no reviews.

2. **Capture ground truth.** Save the current page HTML to
   `tests/fixtures/<source>-<YYYY-MM-DD>.html` and a full-page screenshot to
   `logs/`. Diff against the previous fixture to see exactly what moved.

3. **Fix against the fixture, offline.** Update the parser and make it pass a
   test that reads the NEW fixture. Keep the old fixture and its test — parsers
   must handle both shapes, since a rollback on their end shouldn't break us.

4. **Only then go live.** Re-run `npm run check -- --dry-run` and confirm real
   reviews come back.

5. **Verify dedupe survived.** If review IDs are derived from fields whose
   markup changed, previously-seen reviews will look new and re-append to the
   google docs. Check `data/seen.json` still matches. This is the most likely way a
   selector fix causes damage.

If the diagnosis is **Blocked**, do not add stealth plugins, proxies, or
CAPTCHA-solving. Report it to project owner and fall back to the API path for that
source. Screenshot enrichment is expendable by design; detection is not.
