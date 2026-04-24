#!/usr/bin/env bash
# PreToolUse Edit|Write hook: block edits to generated files.
#
# Exits 2 with a clear message so Claude Code rejects the tool call
# before it runs.
#
# Input: Claude Code pipes JSON on stdin; we pull the file path from it.

set -u

f=$(jq -r '.tool_input.file_path')
if echo "$f" | grep -qE '(bun\.lock|routeTree\.gen\.ts|node_modules/)'; then
  echo 'BLOCK: Do not edit generated files' >&2
  exit 2
fi
exit 0
