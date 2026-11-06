'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { type NotificationSettings, type NotificationSwitch, useNotificationSettings, useSaveNotificationSetting } from '@/features/notifications/api';
import { disablePush, enablePush, type PushStatus, pushStatus } from '@/features/notifications/push';
import { errorMessage } from '@/lib/errors';
import { Body, Button, Caption, Card, ErrorText, Heading, Loading, Screen, StatusText, ToggleRow } from '@/ui/components';
import { useTheme } from '@/ui/ThemeProvider';

const SWITCHES: { key: NotificationSwitch; label: string; description: string }[] = [
  { key: 'friend_requests', label: 'Friend requests', description: 'New requests, and when someone accepts yours' },
  { key: 'ranked', label: 'Ranked', description: 'Challenges, accepted challenges and results to confirm' },
  { key: 'likes', label: 'Likes', description: 'When someone likes your post' },
  { key: 'comments', label: 'Comments', description: 'When someone comments on your post' },
];

const STATUS_TEXT: Record<PushStatus, string> = {
  on: 'Push notifications are on for this phone.',
  off: 'Push notifications are off for this phone.',
  denied: 'Notifications are blocked for MatIQ in your phone settings.',
  unavailable: "Push notifications aren't available in this version of MatIQ yet. You'll still see everything in Activity.",
};

/** Push on or off for this phone, and which kinds of push you get. */
export default function NotificationSettingsScreen() {
  useTheme();
  const settings = useNotificationSettings();
  const save = useSaveNotificationSetting();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void pushStatus().then(setStatus, () => setStatus('unavailable'));
  }, []);

  if (settings.isPending || !status) return <Loading />;
  const current = settings.data;

  const toggle = async (key: NotificationSwitch, value: boolean) => {
    if (!current) return;
    setError(null);
    try {
      await save({ ...current, [key]: value } as NotificationSettings);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <Screen>
      <Card>
        <Heading>This phone</Heading>
        <StatusText>{STATUS_TEXT[status]}</StatusText>
        {status === 'off' ? <Button label="Turn on push notifications" icon="notifications-outline" onPress={async () => setStatus(await enablePush({ ask: true }))} /> : null}
        {status === 'on' ? (
          <Button
            label="Turn off for this phone"
            variant="secondary"
            onPress={async () => {
              await disablePush();
              setStatus('off');
            }}
          />
        ) : null}
        {status === 'denied' ? <Button label="Open phone settings" variant="secondary" icon="settings-outline" onPress={() => Linking.openSettings()} /> : null}
      </Card>

      <Card>
        <Heading>Notify me about</Heading>
        {SWITCHES.map((item) => (
          <ToggleRow
            key={item.key}
            label={item.label}
            description={item.description}
            value={current?.[item.key] ?? true}
            onValueChange={(value) => void toggle(item.key, value)}
          />
        ))}
        <Caption>These switches choose which pushes you get. Activity always shows everything.</Caption>
        <ErrorText>{error ?? (settings.error ? errorMessage(settings.error) : null)}</ErrorText>
      </Card>
      <Body muted>Notifications never include your matches or videos, only who did what.</Body>
    </Screen>
  );
}
