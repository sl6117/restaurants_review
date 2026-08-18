#!/usr/bin/env bash
# PreToolUse hook (Bash) — enforces the project owner's boundary: destructive commands may
# not touch anything outside restaurants_review/.
#
# Only destructive verbs are policed. Reading or listing elsewhere is harmless,
# and blocking it would make the agent useless without making it safer.
set -uo pipefail

proj="${CLAUDE_PROJECT_DIR:-$PWD}"
payload=$(cat)

cmd=$(printf '%s' "$payload" | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try { console.log(JSON.parse(s)?.tool_input?.command ?? ""); }
  catch { console.log(""); }
});
' 2>/dev/null || echo "")

[ -z "$cmd" ] && exit 0

# Not a destructive command? Nothing to check.
printf '%s' "$cmd" | grep -Eq '(^|[;&|(]|[[:space:]])(rm|mv|cp|chmod|chown|ln|dd|truncate|shred)([[:space:]])' || exit 0

while IFS= read -r path; do
  [ -z "$path" ] && continue
  expanded="${path/#\~/$HOME}"
  case "$expanded" in
    "$proj" | "$proj"/*) continue ;;
    /tmp/* | /private/tmp/*) continue ;; # scratchpad is fine
    *)
      echo "BLOCKED — '$path' is outside $proj. The project owner's rule: no destructive changes outside the workspace without his permission. Ask first." >&2
      exit 2
      ;;
  esac
done < <(printf '%s' "$cmd" | grep -oE '(^|[[:space:]"'"'"'=])(/|~/)[^[:space:]"'"'"';|&)]*' | sed -E 's/^[[:space:]"'"'"'=]//' || true)

exit 0
