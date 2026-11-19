'use strict';
// Cognito user management for customer logins (Jomana).
// The customers Lambda's IAM policy allows ONLY these admin actions on ONLY our user pool.

const crypto = require('node:crypto');
const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminUpdateUserAttributesCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const config = require('../../shared/config');

let client;
function cognito() {
  if (!client) client = new CognitoIdentityProviderClient({ region: config.region });
  return client;
}

/** Random temporary password that satisfies the pool policy. Never logged, never stored by us. */
function generateTemporaryPassword() {
  const pick = (chars) => chars[crypto.randomInt(chars.length)];
  const base = crypto.randomBytes(9).toString('base64url');
  return `${base}${pick('ABCDEFGHJKLMNPQRSTUVWXYZ')}${pick('abcdefghijkmnpqrstuvwxyz')}${pick('23456789')}!`;
}

/**
 * Creates the customer's login in the Customer group. The user must change the
 * temporary password at first sign-in (Cognito status FORCE_CHANGE_PASSWORD).
 * inviteMode 'email'    -> Cognito e-mails the temporary password (real AWS).
 * inviteMode 'handover' -> we return it ONCE so staff can hand it over in person
 *                          (Floci has no e-mail delivery). It is never logged or stored.
 */
async function createCustomerLogin({ email, customerId, businessId }) {
  const inviteMode = process.env.CUSTOMER_INVITE_MODE === 'email' ? 'email' : 'handover';
  const temporaryPassword = inviteMode === 'handover' ? generateTemporaryPassword() : undefined;
  const res = await cognito().send(
    new AdminCreateUserCommand({
      UserPoolId: config.cognito.userPoolId,
      Username: email,
      TemporaryPassword: temporaryPassword,
      MessageAction: inviteMode === 'handover' ? 'SUPPRESS' : undefined,
      DesiredDeliveryMediums: inviteMode === 'email' ? ['EMAIL'] : undefined,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'custom:business_id', Value: businessId },
        { Name: 'custom:customer_id', Value: customerId },
      ],
    }),
  );
  // The pool uses "email as username": Cognito's internal Username is the user's sub (a UUID).
  // We store that sub and use it for every later admin call, so changing the e-mail is safe.
  const username = res.User.Username;
  await cognito().send(
    new AdminAddUserToGroupCommand({ UserPoolId: config.cognito.userPoolId, Username: username, GroupName: 'Customer' }),
  );
  return { cognitoSub: username, temporaryPassword, inviteMode };
}

async function deleteLogin(username) {
  await cognito().send(new AdminDeleteUserCommand({ UserPoolId: config.cognito.userPoolId, Username: username }));
}

async function setLoginEnabled(username, enabled) {
  const Command = enabled ? AdminEnableUserCommand : AdminDisableUserCommand;
  await cognito().send(new Command({ UserPoolId: config.cognito.userPoolId, Username: username }));
}

async function updateLoginEmail(oldUsername, newEmail) {
  await cognito().send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: config.cognito.userPoolId,
      Username: oldUsername,
      UserAttributes: [
        { Name: 'email', Value: newEmail },
        { Name: 'email_verified', Value: 'true' },
      ],
    }),
  );
}

module.exports = { createCustomerLogin, deleteLogin, setLoginEnabled, updateLoginEmail, generateTemporaryPassword };
