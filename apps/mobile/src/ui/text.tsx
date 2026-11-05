'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { createContext, use } from 'react';
import { StyleSheet, Text as NativeText, type TextProps, type TextStyle } from 'react-native';
import { useA11y } from '@/features/accessibility/A11yProvider';
import { colors } from './theme';
import { useTheme } from './ThemeProvider';
import { typeface } from './typography';

/** True inside another Text: nested text inherits the parent's face unless it sets its own. */
const InsideText = createContext(false);

/**
 * Text in the app's typefaces (typography.ts) that follows the in-app text
 * size and high-contrast settings, on top of the phone's font size (which
 * React Native applies itself). Used everywhere in the app instead of React
 * Native's Text.
 */
export function Text(props: TextProps) {
  useTheme();
  const nested = use(InsideText);
  const { textScale, highContrast } = useA11y();
  const flat = (StyleSheet.flatten(props.style) ?? {}) as TextStyle;

  // A nested span that only changes colour keeps its parent's face.
  const face = nested && flat.fontWeight === undefined && flat.fontFamily === undefined ? null : typeface(flat);
  // Nested text without its own size inherits the (already scaled) parent size.
  const scale = textScale !== 1 && typeof flat.fontSize === 'number';
  const adjusted: TextStyle | null =
    textScale === 1 && !highContrast
      ? null
      : {
          ...(scale ? { fontSize: (flat.fontSize ?? 0) * textScale } : null),
          ...(scale && typeof flat.lineHeight === 'number' ? { lineHeight: flat.lineHeight * textScale } : null),
          ...(highContrast && (flat.color === colors.textMuted || flat.color === colors.textFaint) ? { color: colors.text } : null),
        };

  return (
    <InsideText value>
      <NativeText {...props} style={face || adjusted ? [props.style, face, adjusted] : props.style} />
    </InsideText>
  );
}
