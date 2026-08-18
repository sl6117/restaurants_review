#!/usr/bin/env bash
# Stop hook — refuses to let a turn end while the test suite is red.
#
# This is the mechanism behind "iterate until done": exit 2 blocks the stop and
# feeds stderr back to Claude, so a failing suite becomes the next instruction
# rather than something to notice later.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$PWD}" || exit 0
payload=$(cat)

# stop_hook_active is true when we already blocked once this turn. Bailing out
# here is what stops a block -> retry -> block infinite loop.
already_active=$(printf '%s' "$payload" | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try { console.log(JSON.parse(s).stop_hook_active ? "1" : "0"); }
  catch { console.log("0"); }
});
' 2>/dev/null || echo "0")
[ "$already_active" = "1" ] && exit 0

# Nothing to gate on yet.
[ -f package.json ] || exit 0
[ -d node_modules ] || exit 0
compgen -G "tests/*.test.ts" >/dev/null || exit 0

if output=$(npm test --silent 2>&1); then
  exit 0
fi

# The spec reporter puts a "failing tests:" block at the end. Prefer that over a
# blind tail, which otherwise reports the last *passing* tests and reads as noise.
failures=$(printf '%s\n' "$output" | sed -n '/^.\{0,4\}failing tests:/,$p')
[ -z "$failures" ] && failures=$(printf '%s\n' "$output" | tail -n 40)

{
  echo "BLOCKED — npm test is failing. Fix this before ending the turn."
  echo "---"
  printf '%s\n' "$failures" | head -n 60
} >&2
exit 2
