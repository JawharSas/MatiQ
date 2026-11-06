/**
 * Firebase Cloud Messaging (HTTP v1) for push notifications.
 *
 * The service account (FCM_SERVICE_ACCOUNT, the JSON key file's contents)
 * signs a short-lived assertion (RS256) that Google swaps for an access
 * token; the token is reused until shortly before it expires. Nothing here
 * logs a token, a key or a message body.
 */

import type { PushMessage } from './push-messages.ts';

export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/** The fields FCM needs from the JSON key, or an error saying what is wrong. */
export function parseServiceAccount(json: string): ServiceAccount {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error('FCM_SERVICE_ACCOUNT is not JSON');
  }
  const projectId = raw.project_id;
  const clientEmail = raw.client_email;
  const privateKey = raw.private_key;
  if (typeof projectId !== 'string' || !/^[a-z0-9-]{4,40}$/.test(projectId)) throw new Error('FCM_SERVICE_ACCOUNT has no valid project_id');
  if (typeof clientEmail !== 'string' || !clientEmail.includes('@')) throw new Error('FCM_SERVICE_ACCOUNT has no client_email');
  if (typeof privateKey !== 'string' || !privateKey.includes('PRIVATE KEY')) throw new Error('FCM_SERVICE_ACCOUNT has no private_key');
  return { projectId, clientEmail, privateKey };
}

const base64url = (bytes: Uint8Array | string) =>
  Buffer.from(bytes).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  return crypto.subtle.importKey('pkcs8', Buffer.from(body, 'base64'), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/** The signed assertion Google's token endpoint takes (valid for an hour). */
export async function signedAssertion(account: ServiceAccount, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: account.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 }));
  const key = await importKey(account.privateKey);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${base64url(new Uint8Array(signature))}`;
}

let cached: { token: string; expiresAt: number; email: string } | null = null;

async function accessToken(account: ServiceAccount): Promise<string> {
  if (cached && cached.email === account.clientEmail && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await signedAssertion(account) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`FCM token request failed (${response.status})`);
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('FCM token response had no token');
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000, email: account.clientEmail };
  return cached.token;
}

export type SendResult = 'sent' | 'invalid_token' | 'failed';

/** The request body FCM takes for one phone. */
export function fcmBody(token: string, message: PushMessage) {
  return {
    message: {
      token,
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: { priority: 'high', notification: { channel_id: 'default' } },
    },
  };
}

/** Sends one message to one phone. A token Firebase no longer knows is reported so it can be removed. */
export async function sendToPhone(account: ServiceAccount, token: string, message: PushMessage): Promise<SendResult> {
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken(account)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(fcmBody(token, message)),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.ok) return 'sent';
  const text = await response.text().catch(() => '');
  if (response.status === 404 || text.includes('UNREGISTERED') || (response.status === 400 && text.includes('registration token'))) return 'invalid_token';
  return 'failed';
}
