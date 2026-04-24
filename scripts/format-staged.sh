#!/usr/bin/env bash
# Reformat staged files with prettier and re-stage any that changed.
#
# Runs from the Claude Code PreToolUse hook on `git commit` (see
# .claude/settings.json). Safe to run manually before committing:
#
#     bash scripts/format-staged.sh
#
# Exits 0 on success even if prettier errored — we never want to block
# a git commit on the hook.

set -u

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

staged=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null)
[ -z "$staged" ] && exit 0

# Feed staged paths to prettier via a null-delimited list so filenames with
# spaces survive. --ignore-unknown drops anything prettier can't handle.
printf '%s\n' "$staged" \
  | tr '\n' '\0' \
  | xargs -0 npx --offline --no-install prettier --write --ignore-unknown --log-level silent \
    >/dev/null 2>&1 || true

# Determine which staged files prettier actually edited (= have a worktree
# diff against the index after the rewrite).
changed=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ -e "$f" ] || continue
  if ! git diff --quiet -- "$f" 2>/dev/null; then
    changed="${changed}${f}
"
  fi
done <<EOF
$staged
EOF

if [ -n "$changed" ]; then
  printf '%s' "$changed" \
    | while IFS= read -r f; do
        [ -n "$f" ] && git add -- "$f"
      done
  printf '[format-staged] reformatted + re-staged:\n'
  printf '%s' "$changed" | sed 's/^/  /'
fi

exit 0
