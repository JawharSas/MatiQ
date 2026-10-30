import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Caption, usePressStyle } from '@/ui/components';
import { Text } from '@/ui/text';
import { colors, font, radius, spacing } from '@/ui/theme';
import type { ModelChoice } from './api';

const SHORT_LIST = 6;

function visionNote(vision: boolean | null): string {
  return vision === true ? 'Reads images' : vision === false ? 'Text only: cannot analyse matches' : 'Image support unknown';
}

/** The models a key can use, the ones that read images first. */
export function ModelPicker({
  models,
  value,
  onChange,
}: {
  models: readonly ModelChoice[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const pressStyle = usePressStyle();
  const [showAll, setShowAll] = useState(false);
  const usable = models.filter((model) => model.vision !== false);
  const selected = models.find((model) => model.id === value);
  const short = usable.slice(0, SHORT_LIST);
  if (selected && !short.includes(selected)) short.unshift(selected);
  const shown = showAll ? models : short;

  return (
    <View style={styles.stack}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Model" style={styles.stack}>
        {shown.map((model) => {
          const checked = model.id === value;
          return (
            <Pressable
              key={model.id}
              accessibilityRole="radio"
              accessibilityState={{ checked, disabled: model.vision === false }}
              aria-checked={checked}
              accessibilityLabel={`${model.id}. ${visionNote(model.vision)}`}
              disabled={model.vision === false}
              onPress={() => onChange(model.id)}
              style={(state) => [styles.row, checked && styles.rowSelected, model.vision === false && styles.rowDisabled, ...pressStyle(state)]}
            >
              <Ionicons name={checked ? 'radio-button-on' : 'radio-button-off'} size={20} color={checked ? colors.accent : colors.control} aria-hidden />
              <View style={styles.fill}>
                <Text style={[font.body, { fontWeight: '600' }]} numberOfLines={1}>
                  {model.id}
                </Text>
                <Caption>{visionNote(model.vision)}</Caption>
              </View>
            </Pressable>
          );
        })}
      </View>
      {models.length > short.length ? (
        <Button
          label={showAll ? 'Show fewer models' : `Show all ${models.length} models`}
          variant="secondary"
          size="sm"
          onPress={() => setShowAll((all) => !all)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  fill: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  rowSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  rowDisabled: { opacity: 0.55 },
});
