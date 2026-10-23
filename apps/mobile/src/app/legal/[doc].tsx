import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { LEGAL_DOCUMENTS, type LegalDocumentId } from '@/features/legal/documents';
import { Body, Caption, Card, Heading, Screen, Title } from '@/ui/components';

export default function LegalDocumentScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const document = doc === 'terms' || doc === 'privacy' ? LEGAL_DOCUMENTS[doc as LegalDocumentId] : LEGAL_DOCUMENTS.privacy;

  return (
    <Screen>
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
