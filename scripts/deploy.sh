#!/usr/bin/env bash
# Deploy vobase template to Railway from the monorepo.
#
# Migrations are generated inside the Docker build (drizzle-kit generate),
# so no local generation needed. The drizzle/ folder is fully gitignored.
#
# Usage: bash scripts/deploy.sh [message]
#   message  — optional deploy message (default: "Deploy")

set -euo pipefail

MESSAGE="${1:-Deploy}"

echo "==> Deploying to Railway..."
railway up --detach --service vobase-app -m "$MESSAGE"

echo "==> Done. Check build logs at:"
echo "    railway logs --service vobase-app --build"
