import { StyleSheet, Text as NativeText, type TextProps, type TextStyle } from 'react-native';
import { useA11y } from '@/features/accessibility/A11yProvider';
import { colors } from './theme';

const SOFT_TEXT = new Set<string>([colors.textMuted, colors.textFaint]);

/**
 * Text that follows the in-app text size and high-contrast settings, on top of
 * the phone's font size (which React Native applies itself). Used everywhere
 * in the app instead of React Native's Text.
 */
export function Text(props: TextProps) {
  const { textScale, highContrast } = useA11y();
  if (textScale === 1 && !highContrast) return <NativeText {...props} />;

  const flat = (StyleSheet.flatten(props.style) ?? {}) as TextStyle;
  // Nested text without its own size inherits the (already scaled) parent size.
  const scale = textScale !== 1 && typeof flat.fontSize === 'number';
  const adjusted: TextStyle = {
    ...(scale ? { fontSize: (flat.fontSize ?? 0) * textScale } : null),
    ...(scale && typeof flat.lineHeight === 'number' ? { lineHeight: flat.lineHeight * textScale } : null),
    ...(highContrast && typeof flat.color === 'string' && SOFT_TEXT.has(flat.color) ? { color: colors.text } : null),
  };
  return <NativeText {...props} style={[props.style, adjusted]} />;
}
