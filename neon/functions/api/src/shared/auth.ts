/**
 * Who is calling: the Clerk session token in `Authorization: Bearer`.
 *
 * The token is checked against Clerk's published keys (issuer, expiry,
 * signature), then mapped to the MatIQ account (the UUID every table uses)
 * with `svc_user_for_clerk`. Clerk session tokens live about a minute, so a
 * signed-out or banned session stops working almost at once. Two-factor is
 * Clerk's: a session only exists once the second factor was given.
 */

import { createRemoteJWKSet, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { rpc } from './db.ts';
import { env } from './env.ts';
import { HttpError } from './http.ts';

export interface AppUser {
  /** The MatIQ account ID. */
  id: string;
  /** The Clerk user ID (the token's `sub`). */
  clerkId: string;
  /** The verified token's claims, for work done as the user. */
  claims: JWTPayload & { sub: string };
}

const BEARER = /^Bearer\s+([A-Za-z0-9._-]{20,4096})$/;

let keys: { issuer: string; jwks: JWTVerifyGetKey } | null = null;

function clerkKeys() {
  const issuer = env.clerkIssuer();
  if (keys?.issuer !== issuer) keys = { issuer, jwks: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) };
  return keys;
}

/** Tests: verify tokens with these keys instead of fetching Clerk's. */
export function useClerkKeys(issuer: string, jwks: JWTVerifyGetKey): void {
  keys = { issuer, jwks };
}

/** The token's claims when Clerk issued it for this app; throws 401 otherwise. */
export async function verifySessionToken(
  token: string,
  options: { issuer: string; keys: JWTVerifyGetKey; authorizedParties: readonly string[] },
): Promise<AppUser['claims']> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, options.keys, {
      issuer: options.issuer,
      algorithms: ['RS256'],
      clockTolerance: 5,
    }));
  } catch {
    throw new HttpError(401, 'unauthorized', 'Invalid or expired session');
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new HttpError(401, 'unauthorized', 'Invalid session');
  // A session with sign-in steps still to do (Clerk's "pending" status) can't act yet.
  if (payload.sts === 'pending') throw new HttpError(401, 'unauthorized', 'Finish signing in first');
  // Browser tokens name the site they were made for; the app's tokens name none.
  const azp = typeof payload.azp === 'string' ? payload.azp : null;
  if (azp && !options.authorizedParties.includes(azp)) throw new HttpError(401, 'unauthorized', 'Token not meant for MatIQ');
  return payload as AppUser['claims'];
}

export async function authenticateRequest(req: Request): Promise<AppUser> {
  const match = BEARER.exec(req.headers.get('Authorization') ?? '');
  if (!match?.[1]) throw new HttpError(401, 'unauthorized', 'Missing bearer token');

  const { issuer, jwks } = clerkKeys();
  const claims = await verifySessionToken(match[1], { issuer, keys: jwks, authorizedParties: env.clerkAuthorizedParties() });

  const { data, error } = await rpc<string | null>('svc_user_for_clerk', { p_clerk_id: claims.sub });
  if (error) throw new Error(`account lookup failed: ${error.message}`);
  // The app opens the account (register_user) right after signing in.
  if (!data) throw new HttpError(403, 'no_account', 'Open the app to finish setting up your account');
  return { id: data, clerkId: claims.sub, claims };
}
