#!/usr/bin/env bash
# 06-api-gateway.sh (owner: Jana - deployment lead)
# One HTTP API in front of the three Lambdas. Only the routes listed here reach our code:
# anything else (e.g. DELETE /api/transactions/x) is answered 404 by API Gateway itself.
# Stage throttling protects the Lambdas and Neon from floods (threat T9).
source "$(dirname "$0")/00-env.sh"

API_ID="${API_ID:-}"
if [ -z "$API_ID" ] || ! aws apigatewayv2 get-api --api-id "$API_ID" >/dev/null 2>&1; then
  API_ID="$(aws apigatewayv2 create-api --name "$API_NAME" --protocol-type HTTP --query ApiId --output text)"
fi
save_output API_ID "$API_ID"
ok "HTTP API $API_ID"

integration_for() {   # integration_for function-name -> integration id
  local fn="$1" uri id
  uri="arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:function:${fn}"
  id="$(aws apigatewayv2 get-integrations --api-id "$API_ID" \
        --query "Items[?IntegrationUri=='$uri'].IntegrationId | [0]" --output text)"
  if [ -z "$id" ] || [ "$id" = "None" ]; then
    id="$(aws apigatewayv2 create-integration --api-id "$API_ID" --integration-type AWS_PROXY \
          --payload-format-version 2.0 --integration-uri "$uri" --timeout-in-millis 15000 \
          --query IntegrationId --output text)"
  fi
  aws lambda add-permission --function-name "$fn" --statement-id apigw-invoke \
    --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:${AWS_REGION}:${ACCOUNT_ID}:${API_ID}/*" >/dev/null 2>&1 || true
  echo "$id"
}

INT_CUSTOMERS="$(integration_for "$FN_CUSTOMERS")"
INT_POINTS="$(integration_for "$FN_POINTS")"
INT_REWARDS="$(integration_for "$FN_REWARDS")"

EXISTING="$(aws apigatewayv2 get-routes --api-id "$API_ID" --query 'Items[].RouteKey' --output text)"
add_route() {   # add_route "METHOD /path" integration-id
  if printf '%s\n' "$EXISTING" | tr '\t' '\n' | grep -qxF "$1"; then return; fi
  aws apigatewayv2 create-route --api-id "$API_ID" --route-key "$1" --target "integrations/$2" >/dev/null
  echo "   route $1"
}

log "Routes -> Customers & Membership"
for r in "GET /api/health" "POST /api/customers" "GET /api/customers" "GET /api/customers/{id}" \
         "PUT /api/customers/{id}" "DELETE /api/customers/{id}" "PATCH /api/customers/{id}/status" \
         "GET /api/customers/{id}/membership" "GET /api/me" "GET /api/reports/active-members" \
         "OPTIONS /api/customers" "OPTIONS /api/customers/{id}" "OPTIONS /api/customers/{id}/status" \
         "OPTIONS /api/customers/{id}/membership" "OPTIONS /api/me" "OPTIONS /api/reports/active-members"; do
  add_route "$r" "$INT_CUSTOMERS"
done

log "Routes -> Points & Transactions"
for r in "POST /api/transactions" "GET /api/transactions" "GET /api/customers/{id}/balance" \
         "POST /api/transactions/{id}/reversals" "POST /api/adjustments" "GET /api/earn-rules" \
         "PUT /api/earn-rules" "GET /api/reports/staff-activity" \
         "OPTIONS /api/transactions" "OPTIONS /api/customers/{id}/balance" "OPTIONS /api/transactions/{id}/reversals" \
         "OPTIONS /api/adjustments" "OPTIONS /api/earn-rules" "OPTIONS /api/reports/staff-activity"; do
  add_route "$r" "$INT_POINTS"
done

log "Routes -> Rewards & Redemption"
for r in "GET /api/rewards" "POST /api/rewards" "PUT /api/rewards/{id}" "DELETE /api/rewards/{id}" \
         "POST /api/redemptions" "GET /api/redemptions" "PATCH /api/redemptions/{id}/status" \
         "GET /api/reports/redemptions" "GET /api/dashboard" \
         "OPTIONS /api/rewards" "OPTIONS /api/rewards/{id}" "OPTIONS /api/redemptions" \
         "OPTIONS /api/redemptions/{id}/status" "OPTIONS /api/reports/redemptions" "OPTIONS /api/dashboard"; do
  add_route "$r" "$INT_REWARDS"
done

log "Stage \$default with throttling"
if ! aws apigatewayv2 get-stage --api-id "$API_ID" --stage-name '$default' >/dev/null 2>&1; then
  aws apigatewayv2 create-stage --api-id "$API_ID" --stage-name '$default' --auto-deploy \
    --default-route-settings ThrottlingBurstLimit=200,ThrottlingRateLimit=100 >/dev/null
else
  aws apigatewayv2 update-stage --api-id "$API_ID" --stage-name '$default' \
    --default-route-settings ThrottlingBurstLimit=200,ThrottlingRateLimit=100 >/dev/null || true
fi

if [ "$TARGET" = "floci" ]; then
  API_URL="http://${API_ID}.execute-api.localhost.floci.io:4566"
else
  API_URL="https://${API_ID}.execute-api.${AWS_REGION}.amazonaws.com"
fi
save_output API_URL "$API_URL"
ok "API URL: $API_URL   (try: curl $API_URL/api/health)"
