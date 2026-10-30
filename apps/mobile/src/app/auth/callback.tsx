import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Loading } from '@/ui/components';

/**
 * Where Google sign-in returns (matiq:///auth/callback). Clerk completes the
 * sign-in in the browser session that opened it; when Android also opens
 * the link in the app, this route just goes on to the app.
 */
export default function AuthCallback() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/');
  }, [router]);
  return <Loading />;
}
