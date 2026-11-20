#!/usr/bin/env bash
# check-deployment.sh (owner: Jana) - quick automatic checks of a deployment.
# Every check prints PASS or FAIL and how to fix it.
source "$(dirname "$0")/00-env.sh"
set +e
PASS=0; FAIL=0
check() { if eval "$2" >/dev/null 2>&1; then echo "PASS $1"; PASS=$((PASS+1)); else echo "FAIL $1  -> $3"; FAIL=$((FAIL+1)); fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

check "Floci/AWS reachable" "aws sts get-caller-identity" "start Floci: docker compose -f infra/floci/docker-compose.yml up -d"
for fn in "$FN_CUSTOMERS" "$FN_POINTS" "$FN_REWARDS" "$FN_EMAIL"; do
  check "Lambda $fn exists" "aws lambda get-function --function-name $fn" "run the matching 0X script"
done
check "DynamoDB $IDEMPOTENCY_TABLE" "aws dynamodb describe-table --table-name $IDEMPOTENCY_TABLE" "run 04-points.sh"
check "SQS $EMAIL_QUEUE" "aws sqs get-queue-url --queue-name $EMAIL_QUEUE" "run 05-rewards.sh"
check "Secret loyalty/brevo-api-key" "aws secretsmanager describe-secret --secret-id loyalty/brevo-api-key" "run 01-foundation.sh"
check "GET /api/health = 200" "[ \"\$(code $API_URL/api/health)\" = 200 ]" "check 06-api-gateway.sh output and Lambda logs"
check "GET /api/customers without token = 401" "[ \"\$(code $API_URL/api/customers)\" = 401 ]" "authenticate middleware missing?"
check "GET /api/rewards with fake token = 401" "[ \"\$(code -H 'Authorization: Bearer abc.def.ghi' $API_URL/api/rewards)\" = 401 ]" "JWT verification"
check "Unknown route blocked by API Gateway = 404" "[ \"\$(code -X DELETE $API_URL/api/transactions/x)\" = 404 ]" "only listed routes should exist"
check "CORS allows our website" "curl -s -i -X OPTIONS -H 'Origin: $FRONTEND_ORIGIN' -H 'Access-Control-Request-Method: POST' $API_URL/api/customers | grep -qi 'access-control-allow-origin: $FRONTEND_ORIGIN'" "set CORS_ORIGINS"
check "CORS refuses evil.example" "! curl -s -i -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST' $API_URL/api/customers | grep -qi 'access-control-allow-origin'" "CORS_ORIGINS must not be *"
check "Website index.html served" "[ \"\$(code $WEB_URL)\" = 200 ]" "run 08-frontend.sh"
check "No .env in public bucket" "! aws s3 ls s3://$WEB_BUCKET --recursive | grep -Eq '\\.env|\\.zip|backend/'" "delete it and rotate the secret!"
check "Reports bucket is private" "[ \"\$(code $PUBLIC_ENDPOINT/$REPORTS_BUCKET/)\" != 200 ] || [ -z '$PUBLIC_ENDPOINT' ]" "re-run 01-foundation.sh"
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
