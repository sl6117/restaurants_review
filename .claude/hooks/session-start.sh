#!/usr/bin/env bash
# SessionStart hook - opens every session with ground truth, so the agent
# never guesses at ledger state or repo position.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$PWD}" || exit 0

seen=$(node -e '
try {
    const s = require("./data/seen.json");
    console.log(Array.isArray(s.ids) ? s.ids.length : "malformed");
} catch { console.log("no ledger yet");}
' 2>/dev/null)

echo "Ground truth at session start:"
echo "- dedupe ledger: ${seen} seen review ids (data/seen.json)"
echo "- last commit: $(git log -1 --oneline 2>/dev/null || echo 'none')"
dirty=$(git status --short 2>/dev/null | wc -l | tr -d ' ')
echo "- working tree: ${dirty} modified/untracked paths"
exit 0