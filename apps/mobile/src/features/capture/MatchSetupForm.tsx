import { type Discipline, variantsFor } from '@matiq/rules-engine';
import { Caption, Card, Heading, Segmented, TextField, ToggleRow } from '@/ui/components';
import type { MatchSetup } from './match-session';

const DISCIPLINES = [
  { value: 'bjj', label: 'BJJ' },
  { value: 'wrestling', label: 'Wrestling' },
  { value: 'mma', label: 'MMA' },
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
    <Card>
      <Heading>Match setup</Heading>
      {rulesetLocked ? (
        <Caption>
          {DISCIPLINES.find((option) => option.value === value.discipline)?.label} · {VARIANT_LABELS[value.variant] ?? value.variant} (set by
          the ranked challenge)
        </Caption>
      ) : (
        <>
          <Segmented
            options={DISCIPLINES}
            value={value.discipline}
            onChange={(discipline) => onChange({ ...defaultSetup(discipline), title: value.title, uploadVideo: value.uploadVideo })}
          />
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
      <TextField label="Title (optional)" value={value.title} onChangeText={(text) => set('title', text)} maxLength={80} />
      <TextField label="Fighter 1 (you)" value={value.athleteALabel} onChangeText={(text) => set('athleteALabel', text)} maxLength={40} />
      <TextField
        label="How to recognise Fighter 1 (e.g. white gi, black shorts)"
        value={value.athleteAHint ?? ''}
        onChangeText={(text) => set('athleteAHint', text || undefined)}
        maxLength={80}
      />
      <TextField label="Fighter 2 (opponent)" value={value.athleteBLabel} onChangeText={(text) => set('athleteBLabel', text)} maxLength={40} />
      <TextField
        label="How to recognise Fighter 2"
        value={value.athleteBHint ?? ''}
        onChangeText={(text) => set('athleteBHint', text || undefined)}
        maxLength={80}
      />
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
  );
}
