/**
 * Browser UI preview: @clerk/expo (and @clerk/expo/token-cache) resolve
 * here, and @clerk/expo/native to clerk-native.tsx. Sign-in runs against the
 * in-memory backend's sample accounts.
 */

import { type ReactNode, useSyncExternalStore } from 'react';
import { previewSessionUserId, previewSignOut, previewUser, subscribePreviewAuth } from '../fake-backend';

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
