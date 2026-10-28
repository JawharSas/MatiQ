import Ionicons from '@expo/vector-icons/Ionicons';
import { Children, type ComponentProps, Fragment, type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, font, radius, spacing } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.screenContent, styles.fill]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={font.title}>{children}</Text>;
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text style={font.heading}>{children}</Text>;
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[font.body, muted && { color: colors.textMuted }]}>{children}</Text>;
}

/** Inline text that reads as a link (use inside expo-router <Link>). */
export function LinkText({ children }: { children: ReactNode }) {
  return <Text style={[font.body, { color: colors.accent, fontWeight: '600' }]}>{children}</Text>;
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
  return <View style={[styles.card, style]}>{children}</View>;
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
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** `sm` for actions inside a list item. */
  size?: 'md' | 'sm';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
}) {
  const inactive = disabled || loading;
  const labelColor = BUTTON_LABEL_COLOR[variant];
  return (
    <Pressable
      accessibilityRole="button"
      // Named explicitly so the spinner state keeps the label for screen readers.
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${variant}`],
        size === 'sm' && styles.buttonSmall,
        pressed && styles.pressed,
        inactive && { opacity: 0.45 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={size === 'sm' ? 16 : 18} color={labelColor} /> : null}
          <Text style={[styles.buttonLabel, size === 'sm' && styles.buttonLabelSmall, { color: labelColor }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function TextField({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.accent}
        autoCorrect={false}
        accessibilityLabel={label}
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
          props.multiline && styles.inputMultiline,
          focused && { borderColor: colors.accent },
          error ? { borderColor: colors.danger } : null,
        ]}
      />
      {error ? <Text style={styles.errorInline}>{error}</Text> : null}
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
      <View style={[styles.fill, { gap: 2 }]}>
        <Text style={[font.body, { fontWeight: '600' }]}>{label}</Text>
        {description ? <Text style={font.caption}>{description}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: colors.accent, false: colors.surfaceHigh }}
        // Explicit on every platform: Android and web otherwise use their own accent colours.
        thumbColor={colors.text}
        // @ts-expect-error react-native-web only: the "on" knob colour.
        activeThumbColor={colors.text}
        accessibilityLabel={label}
      />
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]} numberOfLines={2}>
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
      {icon ? <Ionicons name={icon} size={12} color={foreground} /> : null}
      <Text style={[styles.badgeLabel, { color: foreground }]}>{label}</Text>
    </View>
  );
}

/** Icon in a tinted rounded square. */
export function IconTile({ icon, tone = 'accent', size = 36 }: { icon: IconName; tone?: Tone; size?: number }) {
  const { background, foreground } = TONES[tone];
  return (
    <View style={[styles.iconTile, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: background }]}>
      <Ionicons name={icon} size={Math.round(size * 0.5)} color={foreground} />
    </View>
  );
}

/** Rows separated by hairlines inside one card, like a settings list. */
export function ListGroup({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.listGroup}>
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
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={title}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: colors.surfaceRaised }]}
    >
      {icon ? <IconTile icon={icon} tone={destructive ? 'danger' : tone} /> : null}
      <View style={[styles.fill, { gap: 2 }]}>
        <Text style={[styles.listTitle, destructive && { color: colors.danger }]}>{title}</Text>
        {subtitle ? <Text style={font.caption}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={[font.caption, { color: colors.textMuted }]}>{value}</Text> : null}
      {onPress && !destructive ? <Ionicons name="chevron-forward" size={18} color={colors.textFaint} /> : null}
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

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={28} color={colors.accent} />
      </View>
      <Text style={[font.heading, { textAlign: 'center' }]}>{title}</Text>
      {body ? <Text style={[font.caption, { textAlign: 'center' }]}>{body}</Text> : null}
      {action}
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <View style={styles.errorBox}>
      <Ionicons name="alert-circle" size={18} color={colors.danger} />
      <Text style={styles.errorText} accessibilityRole="alert">
        {children}
      </Text>
    </View>
  );
}

export function Loading() {
  return (
    <View style={[styles.fill, styles.center, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.accent} />
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
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
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
  buttonLabel: { fontSize: 16, fontWeight: '700', letterSpacing: 0.1 },
  buttonSmall: { minHeight: 40, borderRadius: 12, paddingHorizontal: spacing.md },
  buttonLabelSmall: { fontSize: 14 },
  upper: { textTransform: 'uppercase' },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  input: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
    paddingHorizontal: 14,
    fontSize: 16,
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
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  segment: { flex: 1, minHeight: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segmentSelected: { backgroundColor: colors.surfaceHigh },
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
