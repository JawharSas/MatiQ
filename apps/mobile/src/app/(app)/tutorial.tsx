import { useRouter } from 'expo-router';
import { Tutorial } from '@/features/onboarding/Tutorial';

/** The tutorial again, from Settings. */
export default function TutorialScreen() {
  const router = useRouter();
  return <Tutorial onDone={() => router.back()} />;
}
