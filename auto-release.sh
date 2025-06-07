#!/usr/bin/env bash
# Auto‑release with Gemini Flash notes — simplified for reliability

set -euo pipefail
[[ -n "${DEBUG:-}" ]] && set -x

echo "🔄  Auto‑release starting…"

# ─── PRE‑CHECKS ─────────────────────────────────────────────────────────────
[[ -d .git ]] || { echo "❌ Not a Git repo"; exit 1; }
for tool in git jq npm gh curl; do
  command -v "$tool" >/dev/null || { echo "❌ $tool missing"; exit 1; }
done
[[ -n "${FG_GEMINI_API_KEY:-}" ]] || { echo "❌ FG_GEMINI_API_KEY not set"; exit 1; }
MODEL="models/gemini-2.5-flash-preview-05-20"
GEMINI_URL="https://generativelanguage.googleapis.com/v1beta/${MODEL}:generateContent?key=${FG_GEMINI_API_KEY}"

trap 'echo "⚠️  Aborted"; exit 130' INT

# ─── DETERMINE RANGE ─────────────────────────────────────────────────────────
echo "• Determining commit range…"
if git describe --tags --abbrev=0 >/dev/null 2>&1; then
  LAST_TAG=$(git describe --tags --abbrev=0)
  echo "ℹ️  Last tag: $LAST_TAG"
  RANGE="$LAST_TAG..HEAD"
  COMMITS=$(git log --pretty=format:'- %s (%h)' "$RANGE" || true)
  DIFF=$(git diff "$RANGE" || true)
else
  echo "ℹ️  No previous tag found — first release."
  COMMITS=$(git log --pretty=format:'- %s (%h)' HEAD || true)
  DIFF=$(git diff "$(git hash-object -t tree /dev/null)" HEAD || true)
fi

NUM=$(printf '%s\n' "$COMMITS" | grep -c '^- ' || true)
echo "• Found $NUM commit(s) to release."
[[ "$NUM" -gt 0 ]] || { echo "ℹ️  No commits to release. Exiting."; exit 0; }

# ─── BUILD PROMPT ───────────────────────────────────────────────────────────
echo "• Building prompt for Gemini…"
PROMPT="You are an expert release manager.

Given these commit messages and the diff, decide whether the next semantic version bump should be \"major\", \"minor\", or \"patch\". Then write concise release notes.

Return only valid JSON with exactly two fields: \"bump\" and \"notes\".

Until the first major release (i.e. pre 1.0.0), the bump should be \"minor\" or \"patch\" only.

Use semantic versioning principles to determine the appropriate bump.

When the commit message contains the word \"1.0.0\", the bump should be \"major\".

Commit messages:
$COMMITS

---- DIFF BELOW ----
$DIFF
"

# ─── CALL GEMINI ────────────────────────────────────────────────────────────
echo "▶️  Calling Gemini Flash API…"
REQ=$(jq -nc --arg txt "$PROMPT" '{contents:[{parts:[{text:$txt}]}]}')
HTTP=$(curl -sS -w "\n%{http_code}" -H "Content-Type: application/json" -d "$REQ" "$GEMINI_URL")
BODY=$(printf '%s\n' "$HTTP" | sed '$d')
CODE=$(printf '%s\n' "$HTTP" | tail -n1)

if [[ "$CODE" != "200" ]]; then
  echo "❌ Gemini API error (HTTP $CODE)"
  echo "$BODY" | jq . || echo "$BODY"
  exit 1
fi

# Strip any Markdown fences from the returned text
RAW=$(echo "$BODY" | jq -r '.candidates[0].content.parts[0].text')
CLEAN=$(printf '%s\n' "$RAW" | sed -e 's/^```json//i' -e '/^```/d')

# Parse bump and notes
echo "$CLEAN" | jq . >/dev/null 2>&1 || { echo "❌ Invalid JSON from Gemini"; echo "$CLEAN"; exit 1; }
BUMP=$(echo "$CLEAN" | jq -r '.bump')
NOTES=$(echo "$CLEAN" | jq -r '.notes')

[[ "$BUMP" =~ ^(major|minor|patch)$ ]] || { echo "❌ Invalid bump: $BUMP"; exit 1; }

# ─── PREVIEW & CONFIRM ──────────────────────────────────────────────────────
echo
echo "Gemini suggests a **$BUMP** bump."
echo "──── Release notes preview ────"
echo "$NOTES"
echo "────────────────────────────────"
read -p "Proceed with bump & release? [y/N]: " yn
[[ "$yn" =~ ^[Yy]$ ]] || { echo "❌ Release aborted."; exit 2; }

# ─── TAG, PUSH & RELEASE ────────────────────────────────────────────────────
echo "• Tagging version ($BUMP)…"
NEW_TAG=$(npm version "$BUMP" -m "chore(release): v%s")

echo "• Pushing to origin…"
git push --force-with-lease --follow-tags origin

echo "• Creating GitHub release $NEW_TAG …"
gh release create "$NEW_TAG" -t "Upload Goblin $NEW_TAG" -n "$NOTES"

echo "✅ Release $NEW_TAG published!"
