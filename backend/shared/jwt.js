'use strict';
// Verifies Amazon Cognito ID tokens (RS256 JWTs) with Node's built-in crypto.
// Checks, in order: format, algorithm, signature (public key from the user pool's
// JWKS endpoint), issuer, audience (our app client), token_use and expiry.
// Any failure -> the caller answers 401. We never log the token itself.

const crypto = require('node:crypto');

const JWKS_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_S = 30;

function b64urlJson(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

class JwtVerifier {
  constructor({ issuer, audience, jwksUri, tokenUse = 'id', fetchFn = globalThis.fetch }) {
    if (!issuer || !audience || !jwksUri) throw new Error('JwtVerifier needs issuer, audience and jwksUri');
    this.issuer = issuer;
    this.audience = audience;
    this.jwksUri = jwksUri;
    this.tokenUse = tokenUse;
    this.fetchFn = fetchFn;
    this.keys = new Map();
    this.loadedAt = 0;
  }

  async loadKeys(force = false) {
    if (!force && this.keys.size && Date.now() - this.loadedAt < JWKS_TTL_MS) return;
    const res = await this.fetchFn(this.jwksUri, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`JWKS download failed with ${res.status}`);
    const { keys } = await res.json();
    this.keys = new Map(keys.map((jwk) => [jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' })]));
    this.loadedAt = Date.now();
  }

  async getKey(kid) {
    await this.loadKeys();
    if (!this.keys.has(kid)) await this.loadKeys(true); // keys may have rotated
    return this.keys.get(kid);
  }

  /** Returns the verified claims, or throws an Error whose message says why (for logs only). */
  async verify(token) {
    if (typeof token !== 'string' || token.length > 8192) throw new Error('token missing or too long');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('token is not a JWS');

    let header;
    let claims;
    try {
      header = b64urlJson(parts[0]);
      claims = b64urlJson(parts[1]);
    } catch {
      throw new Error('token is not valid base64url JSON');
    }
    if (header.alg !== 'RS256') throw new Error(`unexpected alg ${header.alg}`);

    const key = await this.getKey(header.kid);
    if (!key) throw new Error('unknown signing key');
    const ok = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      key,
      Buffer.from(parts[2], 'base64url'),
    );
    if (!ok) throw new Error('bad signature');

    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== this.issuer) throw new Error('wrong issuer');
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(this.audience)) throw new Error('wrong audience');
    if (claims.token_use !== this.tokenUse) throw new Error('wrong token_use');
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) throw new Error('token expired');
    if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_S > now) throw new Error('token issued in the future');
    return claims;
  }
}

module.exports = { JwtVerifier };
