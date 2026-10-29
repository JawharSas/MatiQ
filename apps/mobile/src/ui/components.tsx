import Ionicons from '@expo/vector-icons/Ionicons';
import { Children, type ComponentProps, Fragment, type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type PressableStateCallbackType,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useA11y } from '@/features/accessibility/A11yProvider';
import { Text } from './text';
import { colors, font, radius, spacing } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** Pressable state on web also reports keyboard focus. */
type PressState = PressableStateCallbackType & { focused?: boolean };

/** Visible keyboard focus (WCAG 2.4.7) and the press feedback, without motion when it is reduced. */
export function usePressStyle() {
  const { reduceMotion } = useA11y();
  return ({ pressed, focused }: PressState): ViewStyle[] => {
    const style: ViewStyle[] = [];
    if (pressed) style.push(reduceMotion ? { opacity: 0.8 } : styles.pressed);
    if (focused) style.push(styles.focusRing);
    return style;
  };
}

/**
 * `focusable` lets keyboard users scroll screens that are only text, such as
 * legal pages (WCAG 2.1.1).
 */
export function Screen({ children, scroll = true, focusable = false }: { children: ReactNode; scroll?: boolean; focusable?: boolean }) {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled" tabIndex={focusable ? 0 : undefined}>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.screenContent, styles.fill]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text style={font.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text style={font.heading} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[font.body, muted && { color: colors.textMuted }]}>{children}</Text>;
}

/** Style for a link inside a sentence: colour and underline, so it does not rely on colour alone (WCAG 1.4.1). */
export const inlineLink = { color: colors.accent, fontWeight: '600', textDecorationLine: 'underline' } as const;

/** Inline text that reads as a link (use inside expo-router <Link>). */
export function LinkText({ children }: { children: ReactNode }) {
  return <Text style={[font.body, { color: colors.accent, fontWeight: '600', textDecorationLine: 'underline' }]}>{children}</Text>;
}

export function Caption({ children }: { children: ReactNode }) {
  return <Text style={font.caption}>{children}</Text>;
}

/** Small uppercase label above a group of content. */
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[font.overline, styles.upper]} accessibilityRole="header">
        {title}
      </Text>
      {action}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { highContrast } = useA11y();
  return <View style={[styles.card, highContrast && styles.highContrastBorder, style]}>{children}</View>;
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BUTTON_LABEL_COLOR: Record<ButtonVariant, string> = {
  primary: colors.accentText,
  secondary: colors.text,
  danger: colors.danger,
  ghost: colors.accent,
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  hint,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** `sm` for actions inside a list item. */
  size?: 'md' | 'sm';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** What happens on press, when the label alone does not say. */
  hint?: string;
}) {
  const { highContrast } = useA11y();
  const pressStyle = usePressStyle();
  const inactive = disabled || loading;
  const labelColor = BUTTON_LABEL_COLOR[variant];
  return (
    <Pressable
      accessibilityRole="button"
      // Named explicitly so the spinner state keeps the label for screen readers.
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      onPress={onPress}
      disabled={inactive}
      style={(state) => [
        styles.button,
        styles[`button_${variant}`],
        size === 'sm' && styles.buttonSmall,
        highContrast && variant !== 'primary' && styles.highContrastBorder,
        ...pressStyle(state),
        inactive && { opacity: 0.45 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={labelColor} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={size === 'sm' ? 16 : 18} color={labelColor} aria-hidden /> : null}
          <Text style={[styles.buttonLabel, size === 'sm' && styles.buttonLabelSmall, { color: labelColor }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function TextField({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  const { textScale } = useA11y();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel} aria-hidden>
        {label}
      </Text>
      <TextInput
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.accent}
        autoCorrect={false}
        accessibilityLabel={label}
        accessibilityHint={error ?? undefined}
        aria-invalid={error ? true : undefined}
        {...props}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        style={[
          styles.input,
          { fontSize: 16 * textScale },
          props.multiline && styles.inputMultiline,
          focused && { borderColor: colors.accent, borderWidth: 2 },
          error ? { borderColor: colors.danger, borderWidth: 2 } : null,
        ]}
      />
      {error ? (
        <Text style={styles.errorInline} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function ToggleRow({
  label,
  description,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={[styles.fill, { gap: 2 }]} aria-hidden>
        <Text style={[font.body, { fontWeight: '600' }]}>{label}</Text>
        {description ? <Text style={font.caption}>{description}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        // The "off" track keeps 3:1 against the card so the switch stays visible (WCAG 1.4.11).
        trackColor={{ true: colors.accent, false: colors.control }}
        // Explicit on every platform: Android and web otherwise use their own accent colours.
        thumbColor={colors.text}
        // @ts-expect-error react-native-web only: the "on" knob colour.
        activeThumbColor={colors.text}
        accessibilityLabel={label}
        accessibilityHint={description}
      />
    </View>
  );
}

/**
 * Tick box, unticked until the person ticks it. The whole row is the target
 * (at least 44 pt high) and the label is part of the control's name.
 */
export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const pressStyle = usePressStyle();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      aria-checked={checked}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}
      style={(state) => [styles.checkRow, ...pressStyle(state)]}
    >
      <View style={[styles.checkBox, checked && styles.checkBoxChecked]}>
        {checked ? <Ionicons name="checkmark" size={18} color={colors.accentText} aria-hidden /> : null}
      </View>
      <Text style={[font.body, styles.fill, { fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}

/** Single choice from a few options, shown as buttons (a radio group for screen readers). */
export function ChoiceChips<T extends string | number>({
  label,
  options,
  value,
  onChange,
  columns = 4,
}: {
  label: string;
  options: readonly { value: T; label: string; accessibilityLabel?: string }[];
  value: T | null;
  onChange: (value: T) => void;
  columns?: number;
}) {
  const pressStyle = usePressStyle();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.chips}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            aria-checked={selected}
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            onPress={() => onChange(option.value)}
            style={(state) => [styles.chip, { flexBasis: `${100 / columns - 3}%` }, selected && styles.chipSelected, ...pressStyle(state)]}
          >
            <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  columns,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** Options per row, for longer lists that would otherwise squeeze their labels. */
  columns?: number;
}) {
  const pressStyle = usePressStyle();
  const { textScale } = useA11y();
  // With bigger text the options stack, so labels are never cut mid-word (WCAG 1.4.4, 1.4.10).
  const stacked = textScale >= 1.3 || (textScale > 1 && options.length > 3);
  const wrapped = !stacked && columns !== undefined && options.length > columns;
  const cell = wrapped ? { flexGrow: 1, flexShrink: 0, flexBasis: `${Math.floor(100 / columns!) - 3}%` as const } : null;
  return (
    <View style={[styles.segmented, stacked && { flexDirection: 'column' }, wrapped && { flexWrap: 'wrap' }]} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={(state) => [styles.segment, stacked && styles.segmentStacked, cell, selected && styles.segmentSelected, ...pressStyle(state)]}
          >
            <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]} numberOfLines={stacked ? undefined : 2}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'blue' | 'neutral';

const TONES: Record<Tone, { background: string; foreground: string }> = {
  accent: { background: colors.accentSoft, foreground: colors.accent },
  success: { background: colors.successSoft, foreground: colors.success },
  warning: { background: colors.warningSoft, foreground: colors.warning },
  danger: { background: colors.dangerSoft, foreground: colors.danger },
  blue: { background: colors.athleteASoft, foreground: colors.athleteA },
  neutral: { background: colors.surfaceHigh, foreground: colors.textMuted },
};

/** Small tinted pill for a status or a tag. */
export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const { background, foreground } = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: background }]}>
      {icon ? <Ionicons name={icon} size={12} color={foreground} aria-hidden /> : null}
      <Text style={[styles.badgeLabel, { color: foreground }]}>{label}</Text>
    </View>
  );
}

/** Icon in a tinted rounded square (decorative: hidden from screen readers). */
export function IconTile({ icon, tone = 'accent', size = 36 }: { icon: IconName; tone?: Tone; size?: number }) {
  const { background, foreground } = TONES[tone];
  return (
    <View
      style={[styles.iconTile, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: background }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      <Ionicons name={icon} size={Math.round(size * 0.5)} color={foreground} />
    </View>
  );
}

/** Rows separated by hairlines inside one card, like a settings list. */
export function ListGroup({ children }: { children: ReactNode }) {
  const { highContrast } = useA11y();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.listGroup, highContrast && styles.highContrastBorder]}>
      {rows.map((row, index) => (
        <Fragment key={index}>
          {index > 0 ? <View style={styles.separator} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

export function ListRow({
  icon,
  tone = 'accent',
  title,
  subtitle,
  value,
  onPress,
  destructive = false,
}: {
  icon?: IconName;
  tone?: Tone;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
}) {
  const pressStyle = usePressStyle();
  return (
    <Pressable
      // The name comes from the visible title, subtitle and value (WCAG 2.5.3).
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={(state) => [styles.listRow, state.pressed && { backgroundColor: colors.surfaceRaised }, (state as PressState).focused && styles.focusRing]}
    >
      {icon ? <IconTile icon={icon} tone={destructive ? 'danger' : tone} /> : null}
      <View style={[styles.fill, { gap: 2 }]}>
        <Text style={[styles.listTitle, destructive && { color: colors.danger }]}>{title}</Text>
        {subtitle ? <Text style={font.caption}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={[font.caption, { color: colors.textMuted }]}>{value}</Text> : null}
      {onPress && !destructive ? <Ionicons name="chevron-forward" size={18} color={colors.textFaint} aria-hidden /> : null}
    </Pressable>
  );
}

export function StatTile({ label, value, tone }: { label: string; value: string | number; tone?: Tone }) {
  return (
    <View style={styles.statTile}>
      <Text style={[styles.statValue, tone && { color: TONES[tone].foreground }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {value}
      </Text>
      <Text style={[font.overline, styles.upper]}>{label}</Text>
    </View>
  );
}

/** Progress towards a goal; screen readers hear the label and the percentage. */
export function ProgressBar({ label, value, color = colors.accent }: { label: string; value: number; color?: string }) {
  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: percent, text: `${percent}%` }}
      style={styles.progressTrack}
    >
      <View style={[styles.progressFill, { width: `${percent}%`, backgroundColor: color }]} />
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
        <Ionicons name={icon} size={28} color={colors.accent} />
      </View>
      <Text style={[font.heading, { textAlign: 'center' }]} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={[font.caption, { textAlign: 'center' }]}>{body}</Text> : null}
      {action}
    </View>
  );
}

/** Error message, announced as soon as it appears (WCAG 4.1.3). */
export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <View style={styles.errorBox} accessibilityLiveRegion="assertive">
      <Ionicons name="alert-circle" size={18} color={colors.danger} aria-hidden />
      <Text style={styles.errorText} accessibilityRole="alert">
        {children}
      </Text>
    </View>
  );
}

/** Status text that screen readers announce when it changes (progress, results). */
export function StatusText({ children }: { children: ReactNode }) {
  return (
    <Text style={font.body} accessibilityLiveRegion="polite" role="status">
      {children}
    </Text>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <View style={[styles.fill, styles.center, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.accent} accessibilityLabel={label} />
    </View>
  );
}

export const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  screen: { flex: 1, backgroundColor: colors.background },
  screenContent: { paddingHorizontal: 20, paddingTop: spacing.md, gap: spacing.lg, paddingBottom: 40 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginBottom: -spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: 18,
    gap: spacing.md,
  },
  highContrastBorder: { borderWidth: 1.5, borderColor: colors.textMuted },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  focusRing: { outlineColor: colors.focus, outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 2 },
  button: {
    minHeight: 52,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  button_primary: { backgroundColor: colors.accent },
  button_secondary: { backgroundColor: colors.surfaceRaised },
  button_danger: { backgroundColor: colors.dangerSoft },
  button_ghost: { backgroundColor: 'transparent', minHeight: 44 },
  buttonLabel: { fontSize: 16, fontWeight: '700', letterSpacing: 0.1, textAlign: 'center' },
  buttonSmall: { minHeight: 44, borderRadius: 12, paddingHorizontal: spacing.md },
  buttonLabelSmall: { fontSize: 14 },
  upper: { textTransform: 'uppercase' },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  input: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    // Visible outline: the field boundary keeps 3:1 against the card (WCAG 1.4.11).
    borderColor: colors.control,
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputMultiline: { minHeight: 104, paddingTop: 14, textAlignVertical: 'top' },
  errorInline: { color: colors.danger, fontSize: 13 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  errorText: { flex: 1, color: colors.danger, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48, borderRadius: radius.md },
  checkBox: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexGrow: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.control,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  chipLabelSelected: { color: colors.accentText, fontWeight: '800' },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  segment: { flex: 1, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segmentStacked: { flex: 0, paddingVertical: 8 },
  // The selected segment is outlined as well as tinted, so it does not rely on a subtle shade (WCAG 1.4.11).
  segmentSelected: { backgroundColor: colors.surfaceHigh, borderWidth: 1.5, borderColor: colors.textMuted },
  segmentLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted, textAlign: 'center' },
  segmentLabelSelected: { color: colors.text, fontWeight: '700' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeLabel: { fontSize: 12, fontWeight: '700' },
  iconTile: { alignItems: 'center', justifyContent: 'center' },
  listGroup: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingHorizontal: 14, paddingVertical: 12 },
  listTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  statTile: { flex: 1, backgroundColor: colors.surfaceRaised, borderRadius: radius.lg, padding: 14, gap: 4 },
  statValue: { fontSize: 20, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceHigh, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4 },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    marginBottom: spacing.xs,
  },
});
