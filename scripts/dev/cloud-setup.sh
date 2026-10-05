#!/usr/bin/env bash
# Claude Code on the web (claude.ai/code): install dependencies and build the shared packages so
# typecheck, lint and tests work in a fresh cloud copy of the repo. Does nothing on your own computer.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "$(dirname "$0")/../.."
command -v pnpm >/dev/null 2>&1 || npm install -g pnpm@10.28.0
pnpm install --frozen-lockfile
pnpm turbo run build --filter='./packages/*' --output-logs=errors-only
