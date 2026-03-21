#!/usr/bin/env bash
# Unified per-file lint: biome + deprecated imports check.
# Usage: scripts/lint-file.sh <file_path>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FILE="$1"
[ -z "$FILE" ] && exit 0

# 1. Biome check with auto-fix
biome check --write "$FILE" 2>/dev/null || true

# 2. Deprecated imports check (TypeScript only)
if [[ "$FILE" =~ \.(ts|tsx)$ ]]; then
  bun run "$SCRIPT_DIR/check-deprecated-imports.ts" "$FILE" || true
fi
