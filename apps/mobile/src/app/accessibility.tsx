import { Linking, Platform } from 'react-native';
import { type MotionPreference, type TextSize, useA11y } from '@/features/accessibility/A11yProvider';
import { contactSupport, supportEmail } from '@/features/legal/contact';
import { Body, Button, Caption, Card, Heading, Screen, Segmented, ToggleRow } from '@/ui/components';

const TEXT_SIZE_OPTIONS: { value: TextSize; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
  { value: 'larger', label: 'Larger' },
  { value: 'largest', label: 'Largest' },
];

const MOTION_OPTIONS: { value: MotionPreference; label: string }[] = [
  { value: 'system', label: 'Phone setting' },
  { value: 'reduce', label: 'Reduce' },
  { value: 'full', label: 'Full' },
];

/**
 * Accessibility settings. Available before and after signing in; they work on
 * top of the phone's own accessibility settings, which MatIQ always follows.
 */
export default function AccessibilityScreen() {
  const a11y = useA11y();

  const openPhoneSettings = () => {
    if (Platform.OS === 'android') void Linking.sendIntent('android.settings.ACCESSIBILITY_SETTINGS').catch(() => Linking.openSettings());
    else void Linking.openSettings();
  };

  return (
    <Screen>
      <Card>
        <Heading>Text size</Heading>
        <Caption>Makes all text in MatIQ bigger, on top of your phone's font size.</Caption>
        <Segmented options={TEXT_SIZE_OPTIONS} value={a11y.textSize} onChange={a11y.setTextSize} />
        <Body>Preview: Alex wins on points, 13 to 2.</Body>
      </Card>
      <Card>
        <ToggleRow
          label="High contrast"
          description="Brighter secondary text and clear outlines around cards, lists and buttons."
          value={a11y.highContrast}
          onValueChange={a11y.setHighContrast}
        />
      </Card>
      <Card>
        <Heading>Motion</Heading>
        <Caption>Reduce turns off screen transitions and press animations. Phone setting follows Remove animations / Reduce Motion.</Caption>
        <Segmented options={MOTION_OPTIONS} value={a11y.motion} onChange={a11y.setMotion} />
      </Card>
      <Card>
        <Heading>Works with your phone</Heading>
        <Body>
          MatIQ supports TalkBack and VoiceOver, your phone's font and display size, colour correction, switch access and a
          keyboard. Every action has a text label, and nothing depends on colour alone.
        </Body>
        {Platform.OS !== 'web' ? <Button label="Open phone accessibility settings" variant="secondary" icon="settings-outline" onPress={openPhoneSettings} /> : null}
      </Card>
      <Card>
        <Heading>Tell us what's hard to use</Heading>
        <Body>We aim to meet WCAG 2.2 level AA. If something in MatIQ is hard to see, hear, read or operate, we want to fix it.</Body>
        <Button
          label={supportEmail ? 'Email accessibility feedback' : 'Send feedback on GitHub'}
          variant="secondary"
          icon={supportEmail ? 'mail-outline' : 'open-outline'}
          onPress={() => contactSupport('MatIQ accessibility feedback')}
        />
      </Card>
    </Screen>
  );
}
