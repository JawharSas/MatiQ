import { useLocalSearchParams, useRouter } from 'expo-router';
import { Linking } from 'react-native';
import { env } from '@/config/env';
import { Body, Button, Caption, Card, Heading, Screen } from '@/ui/components';
import { Text } from '@/ui/text';
import { font } from '@/ui/theme';

/** Reporting a post: copyright notices go to the designated DMCA agent, anything else to support. */
export default function ReportPostScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const id = typeof postId === 'string' ? postId : '';

  const email = (to: string, subject: string, body: string) =>
    void Linking.openURL(`mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);

  const copyrightNotice = () =>
    email(
      env.dmcaAgent.email,
      `Copyright notice: MatIQ post ${id}`,
      [
        `Post ID: ${id}`,
        '',
        'Copyrighted work (what you own):',
        'Your name, postal address and phone number:',
        '',
        'I have a good-faith belief that the use of the material described above is not authorised by the copyright owner, its agent or the law.',
        'The information in this notice is accurate and, under penalty of perjury, I am the copyright owner or authorised to act on their behalf.',
        '',
        'Signature (type your full name):',
      ].join('\n'),
    );

  return (
    <Screen>
      <Body>What is wrong with this post?</Body>
      <Caption>Post ID</Caption>
      <Text style={font.mono} selectable>
        {id}
      </Text>
      <Card>
        <Heading>Copyright infringement</Heading>
        <Body>
          It uses your video, music or other work without permission. This starts an email to our designated copyright agent
          ({env.dmcaAgent.name}) with the post identified and the statements a notice needs.
        </Body>
        <Button label="Email the copyright agent" icon="mail-outline" onPress={copyrightNotice} />
        <Button
          label="Read the Copyright Policy"
          variant="secondary"
          onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'copyright' } })}
        />
      </Card>
      <Card>
        <Heading>Something else</Heading>
        <Body>Harassment, someone filmed without their consent, a child in the footage, or anything else that breaks our Terms.</Body>
        <Button
          label="Email support"
          variant="secondary"
          icon="mail-outline"
          onPress={() => email(env.supportEmail, `Report: MatIQ post ${id}`, `Post ID: ${id}\n\nWhat is wrong:\n`)}
        />
      </Card>
      <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
