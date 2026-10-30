import { Linking, View } from 'react-native';
import { LogoMark } from '@/ui/brand';
import { Body, Button, Caption, Card, Screen, Title } from '@/ui/components';
import { spacing } from '@/ui/theme';
import { APP_VERSION } from './useUpdateRequired';

/** Shown instead of the app when this version is too old (useUpdateRequired). */
export function UpdateRequired({ downloadUrl }: { downloadUrl: string }) {
  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxl }}>
        <LogoMark size={80} />
        <Title>Update MatIQ</Title>
      </View>
      <Card>
        <Body>
          {APP_VERSION ? `MatIQ ${APP_VERSION} is no longer supported.` : 'This version of MatIQ is no longer supported.'} Install the latest
          version to keep training: your account, matches and rank come with you.
        </Body>
        <Button label="Download the update" icon="download" onPress={() => void Linking.openURL(downloadUrl)} />
      </Card>
      <Caption>Already installed it? Close this one and open the new MatIQ.</Caption>
    </Screen>
  );
}
