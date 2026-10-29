import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, use, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { clearCache } from '@/lib/storage';
import { needsMfaChallenge } from './mfa';

interface AuthState {
  session: Session | null;
  initializing: boolean;
  /**
   * The session must complete a two-factor challenge (null while checking).
   * UX only: the server refuses aal1 sessions of users with 2FA anyway.
   */
  mfaPending: boolean | null;
  /** UX hint only: every owner RPC re-checks the role server side. */
  isOwner: boolean;
  signOut(options?: { everywhere?: boolean }): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [mfaPending, setMfaPending] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (mounted) setSession(data.session);
      })
      .finally(() => mounted && setInitializing(false));

    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'SIGNED_OUT') {
        clearCache();
        queryClient.clear();
        setIsOwner(false);
      }
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [queryClient]);

  // Re-evaluated whenever the token changes (sign-in, refresh, MFA verified).
  // The previous value is kept meanwhile, so token refreshes don't flash.
  const accessToken = session?.access_token;
  useEffect(() => {
    if (!accessToken) {
      setMfaPending(null);
      return;
    }
    let cancelled = false;
    void needsMfaChallenge().then((pending) => {
      if (!cancelled) setMfaPending(pending);
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  // Per token, because the owner role can depend on the session's aal.
  useEffect(() => {
    if (!accessToken || mfaPending !== false) return;
    let cancelled = false;
    // GET: answered even before the age check, when other requests are refused.
    supabase.rpc('am_i_owner', undefined, { get: true }).then(({ data }) => {
      if (!cancelled) setIsOwner(data === true);
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken, mfaPending]);

  const signOut = async ({ everywhere = false } = {}) => {
    await supabase.auth.signOut({ scope: everywhere ? 'global' : 'local' });
  };

  return <AuthContext value={{ session, initializing, mfaPending, isOwner, signOut }}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const context = use(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** Signed-in user id; only call inside the authenticated route group. */
export function useUserId(): string {
  const { session } = useAuth();
  if (!session) throw new Error('useUserId requires a session');
  return session.user.id;
}
