#!/usr/bin/env bash
#
# Compare @theshyre/* caret versions in package.json against the
# latest published to GitHub Packages. Exits 0 in all cases (never
# blocks); prints a warning block to stdout only when at least one
# package is behind.
#
# Wired as a SessionStart hook in .claude/settings.json so drift
# surfaces the moment you open this repo. Per CLAUDE.md:
#   > Shyre's @theshyre/* caret ranges in package.json must be ≥ the
#   > latest version published to GitHub Packages at all times.
#
# Auth: GitHub Packages requires NODE_AUTH_TOKEN. The user's shell
# exports it from ~/.bashrc, which zsh doesn't auto-source — so this
# script sources .bashrc explicitly before calling npm view. If the
# token isn't findable we stay silent (no point spamming a warning
# that we can't verify).

set -euo pipefail

# Load NODE_AUTH_TOKEN if the current shell hasn't inherited it.
if [ -z "${NODE_AUTH_TOKEN:-}" ] && [ -f "$HOME/.bashrc" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.bashrc" 2>/dev/null || true
fi

if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
  # No token — silently skip. The alternative is whining every
  # session about something the user has no reason to fix today.
  exit 0
fi

# Resolve repo root relative to this script so the hook works no
# matter where it's invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -f "$REPO_ROOT/package.json" ]; then
  exit 0
fi

PKGS=(ui theme design-tokens)
OUT_OF_DATE=()

for pkg in "${PKGS[@]}"; do
  full="@theshyre/$pkg"

  current=$(node -e "
    const p = require('$REPO_ROOT/package.json');
    const v = (p.dependencies && p.dependencies['$full']) || '';
    process.stdout.write(v.replace(/^[\\^~]/, ''));
  " 2>/dev/null)

  if [ -z "$current" ]; then continue; fi

  latest=$(npm view "$full" version 2>/dev/null || echo "")
  if [ -z "$latest" ]; then continue; fi

  if [ "$current" != "$latest" ]; then
    # Sort semver-aware; if $latest comes last, it's newer than $current.
    newest=$(printf '%s\n%s\n' "$current" "$latest" | sort -V | tail -1)
    if [ "$newest" = "$latest" ]; then
      OUT_OF_DATE+=("$full: $current → $latest")
    fi
  fi
done

if [ ${#OUT_OF_DATE[@]} -eq 0 ]; then
  exit 0
fi

cat <<EOF
⚠️  @theshyre/* packages are behind the registry:

$(printf '    %s\n' "${OUT_OF_DATE[@]}")

Per CLAUDE.md the caret ranges must be ≥ the latest published. Bump before feature work:

    npm install $(printf '%s@latest ' "${OUT_OF_DATE[@]%%:*}")
    npm run typecheck && npm run lint && npm test && npm run build

EOF
