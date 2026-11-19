// (owner: Jomana) Shared helpers for the integration, security and load tests (no dependencies, Node 20+).
// Reads API_URL / Cognito ids from infra/.deploy-outputs.env (written by the deploy
// scripts) unless they are already set in the environment.
// Passwords come ONLY from environment variables (DEMO_PASSWORD), never from files.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputs = path.join(here, '..', 'infra', '.deploy-outputs.env');
if (fs.existsSync(outputs)) {
  for (const line of fs.readFileSync(outputs, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

export const API_URL = (process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '');
export const COGNITO_ENDPOINT = process.env.COGNITO_ENDPOINT || 'http://localhost:4566';
export const CLIENT_ID = process.env.COGNITO_CLIENT_ID;
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
export const ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:4566';

export const DEMO = {
  owner: 'owner@democafe.test',
  staff: 'staff@democafe.test',
  otherOwner: 'owner@othersalon.test',
};

export const uuid = () => crypto.randomUUID();

async function cognito(target, body) {
  const res = await fetch(`${COGNITO_ENDPOINT}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Cognito ${target} failed: ${json.__type || res.status}`);
  return json;
}

/** Sign in; if Cognito asks for a new password (first login), set newPassword. Returns the ID token. */
export async function login(email, password, newPassword) {
  if (!CLIENT_ID) throw new Error('COGNITO_CLIENT_ID not set (run the deploy scripts first)');
  let res = await cognito('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  if (res.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
    res = await cognito('RespondToAuthChallenge', {
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      ClientId: CLIENT_ID,
      Session: res.Session,
      ChallengeResponses: { USERNAME: email, NEW_PASSWORD: newPassword },
    });
  }
  return res.AuthenticationResult.IdToken;
}

/** Call the API. Returns { status, body, headers }. */
export async function api(method, route, { token, body, headers = {}, raw } = {}) {
  const h = { Origin: ORIGIN, ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (raw !== undefined) {
    payload = raw;
    h['Content-Type'] = h['Content-Type'] || 'application/json';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    h['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${API_URL}${route}`, { method, headers: h, body: payload });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers };
}

/** Tiny test runner that prints a results table (copy it into docs/security-tests.md). */
export function createRunner(title) {
  const results = [];
  return {
    async test(id, scenario, expected, fn) {
      let actual;
      let pass = false;
      try {
        actual = await fn();
        pass = actual.pass;
        actual = actual.text;
      } catch (err) {
        actual = `ERROR ${err.message}`;
      }
      results.push({ id, scenario, expected, actual, pass });
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${scenario}  ->  ${actual}`);
    },
    finish() {
      const failed = results.filter((r) => !r.pass).length;
      console.log(`\n${title}: ${results.length - failed} passed, ${failed} failed\n`);
      console.log('| ID | Scenario | Expected | Actual | Result |');
      console.log('|----|----------|----------|--------|--------|');
      for (const r of results) {
        console.log(`| ${r.id} | ${r.scenario} | ${r.expected} | ${String(r.actual).replace(/\|/g, '/')} | ${r.pass ? 'PASS' : 'FAIL'} |`);
      }
      process.exitCode = failed ? 1 : 0;
      return results;
    },
  };
}

/** expect(res, 201) -> { pass, text } */
export function expectStatus(res, status, extra = true) {
  const code = res.body && res.body.error ? ` ${res.body.error.code}` : '';
  return { pass: res.status === status && Boolean(extra), text: `${res.status}${code}` };
}
