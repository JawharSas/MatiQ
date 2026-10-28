import { Stack } from 'expo-router';
import { colors } from '@/ui/theme';

// Signed-out users are redirected to this group (e.g. a cold start at "/"),
// so it needs a default screen.
export const unstable_settings = { anchor: 'sign-in' };

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
