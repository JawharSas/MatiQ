import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Loading } from '@/ui/components';

/**
 * Where Google returns (matiq:///auth/callback), after signing in or after
 * connecting Google in Settings. Clerk completes it in the browser session
 * that opened it; when Android also opens the link in the app, this route
 * goes back to the screen that started it (or on to the app).
 */
export default function AuthCallback() {
  const router = useRouter();
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);
  return <Loading />;
}
