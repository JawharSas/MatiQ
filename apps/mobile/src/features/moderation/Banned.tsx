import { useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '@/features/auth/AuthProvider';
import { contactSupport } from '@/features/legal/contact';
import { Body, Button, Caption, Screen, Title } from '@/ui/components';

/**
 * Shown instead of the app once the account, or the network it signs in
 * from, is banned. The server refuses every request by then; this only
 * explains why and offers a way out.
 */
export function Banned() {
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <Screen>
      <Title>This account is banned</Title>
      <Body>
        MatIQ doesn't allow sexual content, hate or harassment. This account, or the network you're connected to, has been
        blocked from using MatIQ.
      </Body>
      <Caption>
        Sexual content in a video or picture bans an account straight away. If you think this is a mistake, contact support.
      </Caption>
      <View style={{ gap: 12, marginTop: 8 }}>
        <Button
          label="Contact support"
          variant="secondary"
          onPress={() => contactSupport('Ban appeal', 'Please review the ban on my MatIQ account.')}
        />
        <Button
          label="Sign out"
          loading={busy}
          onPress={() => {
            setBusy(true);
            void signOut().finally(() => setBusy(false));
          }}
        />
      </View>
    </Screen>
  );
}
