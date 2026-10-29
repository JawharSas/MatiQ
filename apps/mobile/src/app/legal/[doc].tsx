import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { LEGAL_PAGES, type LegalPageId } from '@/features/legal/documents';
import { Body, Caption, Card, Heading, Screen, Title } from '@/ui/components';

const PAGE_IDS = Object.keys(LEGAL_PAGES) as LegalPageId[];

export default function LegalDocumentScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const document = LEGAL_PAGES[PAGE_IDS.includes(doc as LegalPageId) ? (doc as LegalPageId) : 'privacy'];

  return (
    <Screen focusable>
      <Stack.Screen options={{ title: document.title }} />
      <Title>{document.title}</Title>
      <Caption>Version {document.version}</Caption>
      <Card>
        <Body>{document.summary}</Body>
      </Card>
      {document.sections.map((section) => (
        <View key={section.heading} style={{ gap: 8 }}>
          <Heading>{section.heading}</Heading>
          {section.paragraphs.map((paragraph) => (
            <Body key={paragraph}>{paragraph}</Body>
          ))}
        </View>
      ))}
    </Screen>
  );
}
