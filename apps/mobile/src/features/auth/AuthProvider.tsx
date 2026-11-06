import { useAuth as useClerkAuth, useUser } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, use, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { backend, setTokenGetter } from '@/lib/backend';
import { fromPostgrest, isBannedError } from '@/lib/errors';
import { disablePush } from '@/features/notifications/push';
import { clearCache } from '@/lib/storage';
import { authInitializing } from './init-state';

interface AuthState {
  /** Signed in with Clerk and the MatIQ account is ready. */
  signedIn: boolean;
  initializing: boolean;
  /** The MatIQ account ID (the UUID every table uses), once signed in. */
  userId: string | null;
  email: string;
  /** Signing in worked but the MatIQ account couldn't be opened (shown on the sign-in screen). */
  accountError: Error | null;
  /** Opens the MatIQ account again after `accountError`, with a fresh Clerk token. */
  retryAccount(): void;
  /** UX hint only: every owner RPC re-checks the role server side. */
  isOwner: boolean;
  /** `everywhere` also ends this account's sessions on every other device. */
  signOut(options?: { everywhere?: boolean }): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const CLERK_LOAD_TIMEOUT_MS = 30_000;

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);

/**
 * Clerk handles signing in (its native AuthView: email and password, Google,
 * two-factor). Once a Clerk session exists, the backend client sends its
 * token with every request and the MatIQ account is opened with
 * `register_user`: the same account as before for people who had one
 * (imported with their ID), a new one on first sign-in, named after the
 * Clerk username and name.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { isLoaded, isSignedIn, getToken, signOut: clerkSignOut } = useClerkAuth();
  const { user } = useUser();
  // The MatIQ account and the Clerk user it was opened for.
  const [account, setAccount] = useState<{ clerkUserId: string; userId: string; isOwner: boolean } | null>(null);
  const [accountError, setAccountError] = useState<Error | null>(null);
  // Bumped to open the account again (Try again, or coming back to the app).
  const [attempt, setAttempt] = useState(0);
  const [clerkLoadTimedOut, setClerkLoadTimedOut] = useState(false);
  const getTokenRef = useRef(getToken);

  useEffect(() => {
    getTokenRef.current = getToken;
    setTokenGetter(() => getToken());
  }, [getToken]);

  // An account that didn't open (no network, a server or sign-in setting
  // fixed meanwhile) is tried again when the person comes back to the app.
  // A ban is final, so it isn't.
  useEffect(() => {
    if (!accountError || isBannedError(accountError)) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setAttempt((count) => count + 1);
    });
    return () => subscription.remove();
  }, [accountError]);

  useEffect(() => {
    if (isLoaded) {
      setClerkLoadTimedOut(false);
      return;
    }
    const timeout = setTimeout(() => setClerkLoadTimedOut(true), CLERK_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [isLoaded]);

  const clerkUserId = isSignedIn ? (user?.id ?? null) : null;
  // Nobody until the account for this Clerk user is open: after switching
  // accounts in Clerk's profile screen, the previous one never shows through.
  const current = account && account.clerkUserId === clerkUserId ? account : null;
  const userId = current?.userId ?? null;
  // Plain values, so a refreshed user object (after turning on two-factor,
  // say) doesn't open the account again.
  // (Accounts made before Clerk's own sign-up screen kept these in unsafeMetadata.)
  const metadata = (user?.unsafeMetadata ?? {}) as { username?: unknown; displayName?: unknown };
  const username = text(metadata.username) ?? text(user?.username);
  const displayName = text(metadata.displayName) ?? text(user?.fullName);

  // The session can end or switch to another account outside the app's Sign
  // out (Clerk's profile screen, a revoked session): this device's MatIQ data
  // goes with the previous account either way.
  const previousClerkUserId = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousClerkUserId.current;
    previousClerkUserId.current = clerkUserId;
    if (previous === null || previous === clerkUserId) return;
    clearCache();
    queryClient.clear();
  }, [clerkUserId, queryClient]);

  useEffect(() => {
    if (!clerkUserId) {
      setAccount(null);
      return;
    }
    let cancelled = false;
    setAccountError(null);
    void (async () => {
      // A retry starts with a fresh token: Clerk keeps the last one for up to
      // a minute, and one minted before a fix would fail the same way.
      if (attempt > 0) await getTokenRef.current({ skipCache: true }).catch(() => null);
      if (cancelled) return;
      const open = () => backend.rpc('register_user', { p_username: username, p_display_name: displayName });
      let { data, error } = await open();
      // The first request on a new database connection can come back "not
      // signed in" although the same token works a moment later: try twice
      // more, with a fresh token, before showing the error. A ban is final.
      for (let retry = 1; retry <= 2 && (error || typeof data !== 'string'); retry++) {
        if (cancelled || isBannedError(fromPostgrest(error))) break;
        await new Promise((resolve) => setTimeout(resolve, retry * 800));
        await getTokenRef.current({ skipCache: true }).catch(() => null);
        if (cancelled) return;
        ({ data, error } = await open());
      }
      if (cancelled) return;
      if (error || typeof data !== 'string') {
        setAccountError(fromPostgrest(error) ?? new Error('No account'));
        return;
      }
      // GET: answered even before the age check, when other requests are refused.
      const owner = await backend.rpc('am_i_owner', undefined, { get: true });
      if (!cancelled) setAccount({ clerkUserId, userId: data, isOwner: owner.data === true });
    })();
    return () => {
      cancelled = true;
    };
  }, [clerkUserId, username, displayName, attempt]);

  const signOut = async ({ everywhere = false }: { everywhere?: boolean } = {}) => {
    if (everywhere && user) {
      const sessions = await user.getSessions();
      await Promise.allSettled(sessions.map((session) => session.revoke()));
    }
    // This phone stops getting the account's pushes (while the session still works).
    await disablePush().catch(() => undefined);
    await clerkSignOut();
    clearCache();
    queryClient.clear();
    setAccount(null);
  };

  return (
    <AuthContext
      value={{
        signedIn: Boolean(clerkUserId && userId),
        initializing: authInitializing({
          isClerkLoaded: isLoaded,
          clerkLoadTimedOut,
          clerkUserId,
          userId,
          accountError,
        }),
        userId,
        email: user?.primaryEmailAddress?.emailAddress ?? '',
        accountError,
        retryAccount: () => setAttempt((count) => count + 1),
        isOwner: current?.isOwner ?? false,
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
