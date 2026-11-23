#!/usr/bin/env bash
# Runs every automated suite and prints one PASS/FAIL line per suite.
# Needs: Floci running, app deployed, DEMO_PASSWORD exported:
#   read -s -p "Demo password: " DEMO_PASSWORD; export DEMO_PASSWORD
#   bash tests/run-all.sh 2>&1 | tee ~/run-all-output.txt
set -uo pipefail
cd "$(dirname "$0")/.."
[ -n "${DEMO_PASSWORD:-}" ] || { echo "DEMO_PASSWORD is not set"; exit 1; }
fail=0
run() {
  local name="$1"; shift
  echo "==> $name"
  if "$@"; then echo "<== PASS: $name"; else echo "<== FAIL: $name"; fail=1; fi
  echo
}
run "unit and HTTP tests (backend)" bash -c "cd backend && npm test"
run "end-to-end tests E01-E21" node tests/integration/e2e.mjs
run "security tests S01-S18" node tests/security/run-security-tests.mjs
[ "$fail" -eq 0 ] && echo "ALL SUITES PASSED" || echo "SOME SUITES FAILED"
exit "$fail"
