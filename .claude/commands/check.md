---
description: Run one live review check in dry-run mode and report what would be appended
allowed-tools: Bash(npm run:*), Read
---

Run `npm run check -- --dry-run`.

Report back as a short table: source, reviewer, rating, review date, and whether
each row is NEW or already seen. Do not write anything to the google docs.

If a source errors, say which one and why in one line — do not silently drop it.
A source returning zero reviews and a source failing are different outcomes and
must be reported differently.
