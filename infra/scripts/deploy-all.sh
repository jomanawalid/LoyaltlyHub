#!/usr/bin/env bash
# deploy-all.sh (owner: Jana) - build and deploy the whole system in order.
#   export DEMO_PASSWORD='...'        # demo staff/owner password (never committed)
#   bash infra/scripts/deploy-all.sh  # TARGET=floci by default
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"

echo "==> Building Lambda zips (no .env, no dev dependencies)"
(cd "$ROOT/backend" && npm run zip)

bash "$DIR/01-foundation.sh"
bash "$DIR/02-cognito.sh"
bash "$DIR/03-customers.sh"
bash "$DIR/04-points.sh"
bash "$DIR/05-rewards.sh"
bash "$DIR/09-scaling.sh"
bash "$DIR/06-api-gateway.sh"
bash "$DIR/07-monitoring.sh"
bash "$DIR/10-alerts.sh"
bash "$DIR/08-frontend.sh"
bash "$DIR/check-deployment.sh"
