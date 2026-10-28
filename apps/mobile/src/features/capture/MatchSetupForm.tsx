import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { type Discipline, variantsFor } from '@matiq/rules-engine';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Caption, Card, SectionHeader, Segmented, TextField, ToggleRow } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';
import type { MatchSetup } from './match-session';

const DISCIPLINES = [
  { value: 'bjj', label: 'BJJ', icon: 'karate' },
  { value: 'wrestling', label: 'Wrestling', icon: 'kabaddi' },
  { value: 'mma', label: 'MMA', icon: 'boxing-glove' },
] as const;

export const VARIANT_LABELS: Record<string, string> = {
  ibjjf: 'IBJJF points',
  ibjjf_reversals: 'IBJJF + reversals',
  submission_only: 'Sub only',
  folkstyle: 'Folkstyle',
  freestyle: 'Freestyle',
  unified: 'Unified rules',
};

const ROUND_LENGTHS = [
  { value: '180000', label: '3 min rounds' },
  { value: '300000', label: '5 min rounds' },
] as const;

export function defaultSetup(discipline: Discipline = 'bjj'): MatchSetup {
  return {
    discipline,
    variant: variantsFor(discipline)[0] ?? 'ibjjf',
    title: '',
    athleteALabel: 'Fighter 1',
    athleteBLabel: 'Fighter 2',
    keySource: 'platform',
    uploadVideo: true,
    ...(discipline === 'mma' ? { roundDurationMs: 300_000 } : {}),
  };
}

export function MatchSetupForm({
  value,
  onChange,
  hasOwnKey,
  rulesetLocked = false,
}: {
  value: MatchSetup;
  onChange: (next: MatchSetup) => void;
  hasOwnKey: boolean;
  /** Ranked matches fix the discipline and ruleset agreed in the challenge. */
  rulesetLocked?: boolean;
}) {
  const set = <K extends keyof MatchSetup>(key: K, next: MatchSetup[K]) => onChange({ ...value, [key]: next });

  return (
    <>
      <SectionHeader title="Match setup" />
      <Card>
        {rulesetLocked ? (
          <Caption>
            {DISCIPLINES.find((option) => option.value === value.discipline)?.label} · {VARIANT_LABELS[value.variant] ?? value.variant} (set by
            the ranked challenge)
          </Caption>
        ) : (
          <>
            <View style={styles.sports} accessibilityRole="radiogroup">
              {DISCIPLINES.map((option) => {
                const selected = option.value === value.discipline;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={option.label}
                    onPress={() => onChange({ ...defaultSetup(option.value), title: value.title, uploadVideo: value.uploadVideo })}
                    style={[styles.sport, selected && styles.sportSelected]}
                  >
                    <MaterialCommunityIcons name={option.icon} size={26} color={selected ? colors.accent : colors.textMuted} />
                    <Text style={[styles.sportLabel, selected && { color: colors.text }]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Segmented
              options={variantsFor(value.discipline).map((variant) => ({ value: variant, label: VARIANT_LABELS[variant] ?? variant }))}
              value={value.variant}
              onChange={(variant) => set('variant', variant)}
            />
          </>
        )}
        {value.discipline === 'mma' ? (
          <Segmented
            options={ROUND_LENGTHS}
            value={String(value.roundDurationMs ?? 300_000) as (typeof ROUND_LENGTHS)[number]['value']}
            onChange={(length) => set('roundDurationMs', Number(length))}
          />
        ) : null}
        <TextField label="Title (optional)" placeholder="e.g. Tuesday open mat" value={value.title} onChangeText={(text) => set('title', text)} maxLength={80} />
      </Card>

      <SectionHeader title="Fighters" />
      <Card>
        <View style={styles.corner}>
          <View style={[styles.cornerBar, { backgroundColor: colors.athleteA }]} />
          <View style={styles.cornerFields}>
            <TextField label="Fighter 1 (you)" value={value.athleteALabel} onChangeText={(text) => set('athleteALabel', text)} maxLength={40} />
            <TextField
              label="How to recognise Fighter 1 (e.g. white gi, black shorts)"
              placeholder="White gi"
              value={value.athleteAHint ?? ''}
              onChangeText={(text) => set('athleteAHint', text || undefined)}
              maxLength={80}
            />
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.corner}>
          <View style={[styles.cornerBar, { backgroundColor: colors.athleteB }]} />
          <View style={styles.cornerFields}>
            <TextField label="Fighter 2 (opponent)" value={value.athleteBLabel} onChangeText={(text) => set('athleteBLabel', text)} maxLength={40} />
            <TextField
              label="How to recognise Fighter 2"
              placeholder="Blue gi"
              value={value.athleteBHint ?? ''}
              onChangeText={(text) => set('athleteBHint', text || undefined)}
              maxLength={80}
            />
          </View>
        </View>
      </Card>

      <SectionHeader title="Options" />
      <Card>
        <ToggleRow
          label="Save video to your account"
          description="Needed for highlight playback and sharing. Off = only sampled frames are uploaded."
          value={value.uploadVideo}
          onValueChange={(next) => set('uploadVideo', next)}
        />
        {hasOwnKey ? (
          <ToggleRow
            label="Use my own API key"
            description="Billed to your provider account; does not use your monthly MatIQ analyses."
            value={value.keySource === 'byok'}
            onValueChange={(next) => set('keySource', next ? 'byok' : 'platform')}
          />
        ) : (
          <Caption>Tip: add your own AI provider key in Settings for analyses beyond your monthly quota.</Caption>
        )}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  sports: { flexDirection: 'row', gap: spacing.sm },
  sport: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: colors.surfaceRaised,
  },
  sportSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  sportLabel: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  corner: { flexDirection: 'row', gap: spacing.md },
  cornerBar: { width: 4, borderRadius: 2 },
  cornerFields: { flex: 1, gap: spacing.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
