import { useAuth as useClerkAuth, useUser } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, use, useEffect, useState } from 'react';
import { backend, setTokenGetter } from '@/lib/backend';
import { fromPostgrest } from '@/lib/errors';
import { clearCache } from '@/lib/storage';

interface AuthState {
  /** Signed in with Clerk and the MatIQ account is ready. */
  signedIn: boolean;
  initializing: boolean;
  /** The MatIQ account ID (the UUID every table uses), once signed in. */
  userId: string | null;
  email: string;
  /** Signing in worked but the MatIQ account couldn't be opened (shown on the sign-in screen). */
  accountError: Error | null;
  /** UX hint only: every owner RPC re-checks the role server side. */
  isOwner: boolean;
  /** `everywhere` also ends this account's sessions on every other device. */
  signOut(options?: { everywhere?: boolean }): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);

/**
 * Clerk handles signing in (email and password, Google, two-factor). Once
 * a Clerk session exists, the backend client sends its token with every
 * request and the MatIQ account is opened with `register_user`: the same
 * account as before for people who had one (imported with their ID), a new
 * one on first sign-in, with the username and display name from sign-up.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { isLoaded, isSignedIn, getToken, signOut: clerkSignOut } = useClerkAuth();
  const { user } = useUser();
  const [userId, setUserId] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<Error | null>(null);
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    setTokenGetter(() => getToken());
  }, [getToken]);

  const clerkUserId = isSignedIn ? (user?.id ?? null) : null;
  // Plain values, so a refreshed user object (after turning on two-factor,
  // say) doesn't open the account again.
  const metadata = (user?.unsafeMetadata ?? {}) as { username?: unknown; displayName?: unknown };
  const username = text(metadata.username);
  const displayName = text(metadata.displayName) ?? text(user?.fullName);
  useEffect(() => {
    if (!clerkUserId) {
      setUserId(null);
      setIsOwner(false);
      return;
    }
    let cancelled = false;
    setAccountError(null);
    void (async () => {
      const { data, error } = await backend.rpc('register_user', { p_username: username, p_display_name: displayName });
      if (cancelled) return;
      if (error || typeof data !== 'string') {
        setAccountError(fromPostgrest(error) ?? new Error('No account'));
        return;
      }
      setUserId(data);
      // GET: answered even before the age check, when other requests are refused.
      const owner = await backend.rpc('am_i_owner', undefined, { get: true });
      if (!cancelled) setIsOwner(owner.data === true);
    })();
    return () => {
      cancelled = true;
    };
  }, [clerkUserId, username, displayName]);

  const signOut = async ({ everywhere = false }: { everywhere?: boolean } = {}) => {
    if (everywhere && user) {
      const sessions = await user.getSessions();
      await Promise.allSettled(sessions.map((session) => session.revoke()));
    }
    await clerkSignOut();
    clearCache();
    queryClient.clear();
    setUserId(null);
    setIsOwner(false);
  };

  return (
    <AuthContext
      value={{
        signedIn: Boolean(clerkUserId && userId),
        initializing: !isLoaded || Boolean(clerkUserId && !userId && !accountError),
        userId,
        email: user?.primaryEmailAddress?.emailAddress ?? '',
        accountError,
        isOwner,
        signOut,
      }}
    >
      {children}
    </AuthContext>
  );
}

export function useAuth(): AuthState {
  const context = use(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** Signed-in user id; only call inside the authenticated route group. */
export function useUserId(): string {
  const { userId } = useAuth();
  if (!userId) throw new Error('useUserId requires a signed-in user');
  return userId;
}
