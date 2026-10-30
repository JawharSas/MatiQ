'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { Stack } from 'expo-router';
import { colors } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';

// Signed-out users are redirected to this group (e.g. a cold start at "/"),
// so it needs a default screen.
export const unstable_settings = { anchor: 'sign-in' };

export default function AuthLayout() {
  useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
