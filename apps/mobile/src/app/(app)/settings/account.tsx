'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { UserProfileView } from '@clerk/expo/native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';

/**
 * Account and security: Clerk's native profile screen (email addresses,
 * password, Google and other connected accounts, two-factor, signed-in
 * devices). Signing out here ends the Clerk session, and AuthProvider then
 * clears this device's MatIQ data as it does for the app's own Sign out.
 */
export default function AccountScreen() {
  useTheme();
  const router = useRouter();
  return (
    <SafeAreaView style={styles.root} edges={['left', 'right']}>
      <UserProfileView style={styles.root} isDismissible={false} onHostBack={() => router.back()} />
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  root: { flex: 1, backgroundColor: colors.background },
}));
