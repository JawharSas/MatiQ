/**
 * Browser UI preview: @clerk/expo (and @clerk/expo/token-cache) resolve
 * here. Sign-in runs against the in-memory backend's sample accounts with
 * the same hooks and result shapes the screens use with Clerk.
 */

import { type ReactNode, useSyncExternalStore } from 'react';
import { previewSessionUserId, previewSignIn, previewSignOut, previewSignUp, previewUser, subscribePreviewAuth } from '../fake-backend';

export function ClerkProvider({ children }: { children: ReactNode; publishableKey?: string; tokenCache?: unknown }) {
  return children;
}

export const tokenCache = undefined;

const useSignedInUserId = () => useSyncExternalStore(subscribePreviewAuth, previewSessionUserId);

const getToken = async () => (previewSessionUserId() ? 'preview-token' : null);

export function useAuth() {
  const userId = useSignedInUserId();
  return { isLoaded: true, isSignedIn: userId !== null, userId, getToken, signOut: previewSignOut };
}

export function useUser() {
  const user = useSyncExternalStore(subscribePreviewAuth, previewUser);
  return { isLoaded: true, isSignedIn: user !== null, user };
}

export function useSignIn() {
  return { signIn: previewSignIn };
}

export function useSignUp() {
  return { signUp: previewSignUp };
}

export function useSSO() {
  // No browser hand-off in the preview: behaves as if the window was closed.
  return { startSSOFlow: async () => ({ createdSessionId: null, setActive: undefined, signIn: undefined, signUp: undefined, authSessionResult: { type: 'cancel' } }) };
}
