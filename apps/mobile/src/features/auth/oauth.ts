/**
 * "Continue with Google": Supabase's OAuth flow with PKCE in the system
 * browser (Custom Tabs on Android, ASWebAuthenticationSession on iOS). The
 * Google client secret stays in Supabase; the app only ever sees a one-time
 * code that is useless without the verifier kept in the encrypted local store.
 */

import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '@/lib/supabase';

const CODE = /^[A-Za-z0-9-]{8,128}$/;
const pending = new Map<string, Promise<void>>();

/** An error whose message can be shown to the person as is. */
export class SignInError extends Error {
  override name = 'SignInError';
}

/**
 * Exchanges an auth code for a session once. On Android the redirect reaches
 * both the browser session and the /auth/callback route, so both end up here
 * with the same code; the second caller waits for the first exchange.
 */
export function exchangeAuthCode(code: string): Promise<void> {
  if (!CODE.test(code)) return Promise.reject(new SignInError('This sign-in link is not valid.'));
  let exchange = pending.get(code);
  if (!exchange) {
    exchange = supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) throw new SignInError('Sign-in did not complete. Please try again.');
    });
    pending.set(code, exchange);
  }
  return exchange;
}

/** Message for an `error_description` that Supabase or Google put on the redirect. */
export function redirectErrorMessage(description: string | undefined): string {
  return description && /cancel|denied/i.test(description)
    ? 'Google sign-in was cancelled.'
    : 'Google sign-in did not complete. Please try again.';
}

/** Resolves once signed in, or with 'cancelled' if the person closed the browser. */
export async function signInWithGoogle(): Promise<'signed-in' | 'cancelled'> {
  const redirectTo = Linking.createURL('/auth/callback');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
  });
  if (error || !data.url) throw new SignInError('Google sign-in is not available right now.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return 'cancelled';

  const params = Linking.parse(result.url).queryParams ?? {};
  const code = typeof params.code === 'string' ? params.code : undefined;
  if (!code) {
    throw new SignInError(redirectErrorMessage(typeof params.error_description === 'string' ? params.error_description : undefined));
  }
  await exchangeAuthCode(code);
  return 'signed-in';
}
