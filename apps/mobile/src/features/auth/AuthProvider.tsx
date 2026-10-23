import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, use, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { clearCache } from '@/lib/storage';
import { recordPendingConsent } from '@/features/legal/consent';

interface AuthState {
  session: Session | null;
  initializing: boolean;
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
      if (event === 'SIGNED_IN' && next) {
        // Defer Supabase calls out of the auth callback to avoid deadlocks.
        setTimeout(() => void recordPendingConsent(next.user.email ?? ''), 0);
      }
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [queryClient]);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase.rpc('am_i_owner').then(({ data }) => {
      if (!cancelled) setIsOwner(data === true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const signOut = async ({ everywhere = false } = {}) => {
    await supabase.auth.signOut({ scope: everywhere ? 'global' : 'local' });
  };

  return <AuthContext value={{ session, initializing, isOwner, signOut }}>{children}</AuthContext>;
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
