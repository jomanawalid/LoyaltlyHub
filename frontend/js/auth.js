// Authentication with Amazon Cognito (owner: Jomana).
// The browser talks to Cognito directly (InitiateAuth). The app client has no secret,
// so nothing secret is in this file. The ID token is kept in sessionStorage (cleared
// when the tab closes), sent only in the Authorization header (not a cookie -> no CSRF),
// and never logged. The role shown in the UI is for navigation only: the backend
// re-checks the signed token on every request.
import { config } from './config.js';

const KEY = 'loyalty.idToken';

async function cognito(target, body) {
  const res = await fetch(`${config.cognitoEndpoint}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Same message for wrong e-mail and wrong password: do not reveal which accounts exist.
    const type = String(json.__type || '');
    if (type.includes('NotAuthorized') || type.includes('UserNotFound')) throw new Error('Incorrect e-mail or password.');
    if (type.includes('InvalidPassword')) throw new Error('Password too weak: use 10+ characters with upper case, lower case and a number.');
    if (type.includes('TooManyRequests') || type.includes('LimitExceeded')) throw new Error('Too many attempts. Please wait and try again.');
    throw new Error('Sign-in failed. Please try again.');
  }
  return json;
}

function store(result) {
  sessionStorage.setItem(KEY, result.AuthenticationResult.IdToken);
}

/** @returns {Promise<{ done: true } | { challenge: 'NEW_PASSWORD_REQUIRED', session: string }>} */
export async function signIn(email, password) {
  const res = await cognito('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: config.cognitoClientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  if (res.ChallengeName === 'NEW_PASSWORD_REQUIRED') return { challenge: res.ChallengeName, session: res.Session };
  store(res);
  return { done: true };
}

export async function completeNewPassword(email, session, newPassword) {
  const res = await cognito('RespondToAuthChallenge', {
    ChallengeName: 'NEW_PASSWORD_REQUIRED',
    ClientId: config.cognitoClientId,
    Session: session,
    ChallengeResponses: { USERNAME: email, NEW_PASSWORD: newPassword },
  });
  store(res);
}

export function getToken() {
  const token = sessionStorage.getItem(KEY);
  if (!token) return null;
  const claims = decodeClaims(token);
  if (!claims || claims.exp * 1000 < Date.now()) {
    signOut();
    return null;
  }
  return token;
}

/** Reads (does NOT verify) the token payload, only to choose which menu to show. */
export function decodeClaims(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

export function currentUser() {
  const token = getToken();
  if (!token) return null;
  const c = decodeClaims(token);
  const groups = c['cognito:groups'] || [];
  const role = ['Owner', 'Staff', 'Customer'].find((r) => groups.includes(r)) || 'None';
  return { email: c.email, role, customerId: c['custom:customer_id'] || null };
}

export function signOut() {
  sessionStorage.removeItem(KEY);
}

export function requireLogin() {
  const user = currentUser();
  if (!user) window.location.replace('index.html');
  return user;
}
