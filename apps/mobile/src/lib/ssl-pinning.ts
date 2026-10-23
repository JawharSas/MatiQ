/**
 * TLS public-key pinning for the Supabase host.
 *
 * Applies to every request made through `fetch` (Auth, Data API, Realtime
 * handshake, Edge Functions). Pins are SHA-256 hashes of the
 * SubjectPublicKeyInfo of certificates in the chain; at least two are
 * required (primary + backup) so a certificate rotation cannot lock users
 * out. An optional expiry date makes pinning fail open for app versions that
 * are never updated.
 */

import {
  addSslPinningErrorListener,
  initializeSslPinning,
  isSslPinningAvailable,
} from 'react-native-ssl-public-key-pinning';
import { env, supabaseHost } from '@/config/env';

export type PinningStatus = 'enabled' | 'not_configured' | 'unavailable';

let status: Promise<PinningStatus> | null = null;

export function enableCertificatePinning(): Promise<PinningStatus> {
  status ??= (async (): Promise<PinningStatus> => {
    if (env.tlsPins.length === 0) return 'not_configured';
    if (env.tlsPins.length < 2) {
      throw new Error('EXPO_PUBLIC_TLS_PINS needs at least two pins (primary and backup).');
    }
    if (!isSslPinningAvailable()) return 'unavailable';

    await initializeSslPinning({
      [supabaseHost]: {
        includeSubdomains: false,
        publicKeyHashes: env.tlsPins,
        ...(env.tlsPinsExpire ? { expirationDate: env.tlsPinsExpire } : {}),
      },
    });
    addSslPinningErrorListener((error) => {
      // A pin mismatch means a proxy or attacker presented a different
      // certificate. The request has already been blocked natively.
      console.warn(`TLS pin validation failed for ${error.serverHostname}`);
    });
    return 'enabled';
  })();
  return status;
}
