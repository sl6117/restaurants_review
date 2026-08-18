#!/usr/bin/env bash
# PostToolUse hook — type-checks the project the moment a .ts file is written.
# Surfaces a type error at the edit that caused it instead of three files later.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$PWD}" || exit 0
payload=$(cat)

file=$(printf '%s' "$payload" | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try { console.log(JSON.parse(s)?.tool_input?.file_path ?? ""); }
  catch { console.log(""); }
});
' 2>/dev/null || echo "")

case "$file" in
  *.ts | *.tsx) ;;
  *) exit 0 ;;
esac

[ -f tsconfig.json ] || exit 0
[ -d node_modules/typescript ] || exit 0

if output=$(npx --no-install tsc --noEmit 2>&1); then
  exit 0
fi

{
  echo "Type errors after editing ${file}:"
  printf '%s\n' "$output" | head -n 30
} >&2
exit 2
