#!/usr/bin/env bash
# PostToolUse Edit|Write hook: run post-edit checks against the edited file.
#
# Checks:
#   1. biome check --write --unsafe (auto-fixes silently, blocks on unfixable
#      lint errors, ignores out-of-scope paths).
#   2. check-deprecated-imports (only for .ts/.tsx files).
#
# Emits one line per biome diagnostic via --reporter=github and the raw
# deprecated-imports output. Exits 2 if any check fails so the error
# reaches Claude via Claude Code's hook protocol.
#
# Input: Claude Code pipes JSON on stdin; we pull the file path from it.

set -u

f=$(jq -r '.tool_input.file_path')
had_error=0

# Biome
out=$("$CLAUDE_PROJECT_DIR/node_modules/.bin/biome" check --write --unsafe --reporter=github "$f" 2>&1)
if [ $? -ne 0 ] && ! echo "$out" | grep -q 'No files were processed'; then
  echo "$out" | grep '^::' >&2
  had_error=1
fi

# Deprecated imports (TS only)
if [[ "$f" =~ \.(ts|tsx)$ ]]; then
  if ! bun run "$CLAUDE_PROJECT_DIR/scripts/check-deprecated-imports.ts" "$f" >&2; then
    had_error=1
  fi
fi

[ $had_error -eq 0 ] && exit 0 || exit 2
