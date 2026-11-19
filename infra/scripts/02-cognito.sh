#!/usr/bin/env bash
# 02-cognito.sh (owner: Jomana - authentication lead)
# Cognito user pool = login for all three roles. Groups = roles in the token.
#   - e-mail is the username, strong password policy, temporary passwords expire in 3 days
#   - custom:business_id / custom:customer_id are put in the ID token and read by the API
#   - app client has NO secret (browser app) and only allows USER_PASSWORD_AUTH + refresh
#   - ID tokens live 1 hour
#
# Demo staff/owner users: needs DEMO_PASSWORD in your shell (never committed), e.g.
#   read -s -p "Demo password: " DEMO_PASSWORD; export DEMO_PASSWORD
source "$(dirname "$0")/00-env.sh"

DEMO_BUSINESS="11111111-1111-4111-8111-111111111111"   # "Demo Cafe" from database/seed.sql
OTHER_BUSINESS="22222222-2222-4222-8222-222222222222"  # second tenant for isolation tests

log "Cognito user pool"
POOL_ID="${COGNITO_USER_POOL_ID:-}"
if [ -z "$POOL_ID" ] || ! aws cognito-idp describe-user-pool --user-pool-id "$POOL_ID" >/dev/null 2>&1; then
  POOL_ID="$(aws cognito-idp create-user-pool --pool-name loyalty-users \
    --username-attributes email \
    --auto-verified-attributes email \
    --policies 'PasswordPolicy={MinimumLength=10,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=false,TemporaryPasswordValidityDays=3}' \
    --admin-create-user-config 'AllowAdminCreateUserOnly=true' \
    --schema Name=business_id,AttributeDataType=String,Mutable=false Name=customer_id,AttributeDataType=String,Mutable=false \
    --query UserPool.Id --output text)"
fi
save_output COGNITO_USER_POOL_ID "$POOL_ID"
ok "pool $POOL_ID (self sign-up disabled: only staff/owner create accounts)"

for group in Owner Staff Customer; do
  aws cognito-idp get-group --user-pool-id "$POOL_ID" --group-name "$group" >/dev/null 2>&1 ||
    aws cognito-idp create-group --user-pool-id "$POOL_ID" --group-name "$group" >/dev/null
done
ok "groups Owner, Staff, Customer"

CLIENT_ID="${COGNITO_CLIENT_ID:-}"
if [ -z "$CLIENT_ID" ]; then
  CLIENT_ID="$(aws cognito-idp create-user-pool-client --user-pool-id "$POOL_ID" --client-name loyalty-web \
    --no-generate-secret --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
    --prevent-user-existence-errors ENABLED \
    --id-token-validity 60 --access-token-validity 60 --refresh-token-validity 1 \
    --token-validity-units 'IdToken=minutes,AccessToken=minutes,RefreshToken=days' \
    --query UserPoolClient.ClientId --output text)"
fi
save_output COGNITO_CLIENT_ID "$CLIENT_ID"
if [ "$TARGET" = "floci" ]; then ISSUER="http://localhost:4566/$POOL_ID"; else ISSUER="https://cognito-idp.$AWS_REGION.amazonaws.com/$POOL_ID"; fi
save_output COGNITO_ISSUER "$ISSUER"
ok "app client $CLIENT_ID, issuer $ISSUER"

create_demo_user() {   # email group business_id
  if aws cognito-idp admin-get-user --user-pool-id "$POOL_ID" --username "$1" >/dev/null 2>&1; then
    ok "user $1 exists"; return
  fi
  aws cognito-idp admin-create-user --user-pool-id "$POOL_ID" --username "$1" --message-action SUPPRESS \
    --user-attributes Name=email,Value="$1" Name=email_verified,Value=true Name=custom:business_id,Value="$3" >/dev/null
  aws cognito-idp admin-set-user-password --user-pool-id "$POOL_ID" --username "$1" \
    --password "$DEMO_PASSWORD" --permanent
  aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL_ID" --username "$1" --group-name "$2"
  ok "user $1 in group $2"
}

if [ -n "${DEMO_PASSWORD:-}" ]; then
  log "Demo users (password from \$DEMO_PASSWORD, not stored anywhere)"
  create_demo_user owner@democafe.test  Owner "$DEMO_BUSINESS"
  create_demo_user staff@democafe.test  Staff "$DEMO_BUSINESS"
  create_demo_user owner@othersalon.test Owner "$OTHER_BUSINESS"
else
  warn "DEMO_PASSWORD not set: skipped demo users. Set it and run this script again."
fi

cat <<MSG

Put these in backend/.env for local development (they are not secrets):
  COGNITO_USER_POOL_ID=$POOL_ID
  COGNITO_CLIENT_ID=$CLIENT_ID
  COGNITO_ISSUER=$ISSUER
MSG
