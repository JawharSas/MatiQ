/**
 * "Continue with Google" through Clerk: Google's sign-in runs in the system
 * browser (Custom Tabs on Android, ASWebAuthenticationSession on iOS) and
 * returns to matiq://auth/callback, where Clerk completes it. The Google
 * client secret stays with Clerk. The first Google sign-in creates the
 * account; an existing MatIQ account with the same verified email is the
 * same account.
 */

import { useSSO } from '@clerk/expo';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { clerkErrorMessage } from './clerk-errors';

WebBrowser.maybeCompleteAuthSession();

/** An error whose message can be shown to the person as is. */
export class SignInError extends Error {
  override name = 'SignInError';
}

/**
 * 'signed-in', 'cancelled' (the browser was closed), or 'second-factor' when
 * the account has two-factor on: the sign-in screen asks for the code.
 */
export type GoogleResult = 'signed-in' | 'cancelled' | 'second-factor';

export function useGoogleSignIn(): () => Promise<GoogleResult> {
  const { startSSOFlow } = useSSO();
  return async () => {
    let result: Awaited<ReturnType<typeof startSSOFlow>>;
    try {
      result = await startSSOFlow({ strategy: 'oauth_google', redirectUrl: Linking.createURL('/auth/callback') });
    } catch (error) {
      throw new SignInError(clerkErrorMessage(error));
    }
    const { createdSessionId, setActive, signIn, authSessionResult } = result;
    if (createdSessionId && setActive) {
      await setActive({ session: createdSessionId });
      return 'signed-in';
    }
    if (authSessionResult?.type !== 'success') return 'cancelled';
    if (signIn?.status === 'needs_second_factor') return 'second-factor';
    throw new SignInError('Google sign-in did not complete. Please try again.');
  };
}
