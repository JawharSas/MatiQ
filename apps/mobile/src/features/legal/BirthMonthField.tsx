import { Platform, View } from 'react-native';
import { Caption, ChoiceChips, Heading, TextField } from '@/ui/components';
import { type BirthInput, MONTH_NAMES } from './age-rule';

const MONTH_OPTIONS = MONTH_NAMES.map((name, index) => ({ value: index + 1, label: name.slice(0, 3), accessibilityLabel: name }));

/**
 * Neutral age screen: asks everyone for a birth month and year, without
 * hinting at the minimum age or pre-selecting an answer.
 */
export function BirthMonthField({ value, onChange }: { value: BirthInput; onChange: (value: BirthInput) => void }) {
  return (
    <View style={{ gap: 12 }}>
      <Heading>Date of birth</Heading>
      <Caption>We ask everyone. It is never shown on your profile.</Caption>
      <ChoiceChips label="Birth month" options={MONTH_OPTIONS} value={value.month} onChange={(month) => onChange({ ...value, month })} />
      <TextField
        label="Birth year"
        value={value.year}
        onChangeText={(year) => onChange({ ...value, year: year.replace(/\D/g, '') })}
        keyboardType="number-pad"
        maxLength={4}
        placeholder="YYYY"
        // Identifies the field's purpose for autofill and assistive tech (WCAG 1.3.5); the web uses the HTML token.
        autoComplete={Platform.OS === 'web' ? ('bday-year' as 'birthdate-year') : 'birthdate-year'}
        textContentType="none"
      />
    </View>
  );
}
