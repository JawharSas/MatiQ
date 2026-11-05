import type { TextStyle } from 'react-native';

/**
 * The app's two typefaces: Barlow for text and Barlow Condensed for scores,
 * numbers and headings. Styles keep saying what they mean with `fontWeight`,
 * and ask for the condensed face with `fontFamily: CONDENSED`; `typeface()`
 * turns that into the family name of the right font file, because Android
 * picks a custom font's face by its name, not by `fontWeight`.
 *
 * The files (`fonts.ts`) load before the splash screen hides (root layout). Until they
 * have loaded, or if loading failed, `typeface()` changes nothing and the
 * phone's own font is used.
 */
export const CONDENSED = 'Condensed';

const TEXT_FACES: Record<number, string> = {
  400: 'Barlow_400Regular',
  500: 'Barlow_500Medium',
  600: 'Barlow_600SemiBold',
  700: 'Barlow_700Bold',
  800: 'Barlow_800ExtraBold',
};
const CONDENSED_FACES: Record<number, string> = {
  600: 'BarlowCondensed_600SemiBold',
  700: 'BarlowCondensed_700Bold',
  800: 'BarlowCondensed_800ExtraBold',
};

let loaded = false;

/** Called once the font files have loaded. */
export function markFontsLoaded(): void {
  loaded = true;
}

function weightOf(weight: TextStyle['fontWeight']): number {
  if (weight === 'bold') return 700;
  if (weight === undefined || weight === 'normal') return 400;
  const value = Number(weight);
  return Number.isFinite(value) ? value : 400;
}

/** The loaded face nearest to `weight` (the heavier one on a tie). */
export function nearestFace(faces: Record<number, string>, weight: number): string {
  let best = 0;
  for (const key of Object.keys(faces).map(Number)) {
    if (best === 0 || Math.abs(key - weight) < Math.abs(best - weight) || (Math.abs(key - weight) === Math.abs(best - weight) && key > best)) {
      best = key;
    }
  }
  return faces[best] ?? '';
}

/**
 * The family (and a plain weight) for a text style, or null to leave it as
 * it is: before the fonts load, and for another font (icons, monospace).
 */
export function typeface(style: Pick<TextStyle, 'fontFamily' | 'fontWeight'>, fontsLoaded = loaded): TextStyle | null {
  if (!fontsLoaded) return null;
  const family = style.fontFamily;
  if (family !== undefined && family !== CONDENSED) return null;
  const faces = family === CONDENSED ? CONDENSED_FACES : TEXT_FACES;
  return { fontFamily: nearestFace(faces, weightOf(style.fontWeight)), fontWeight: 'normal' };
}

/** For styles handed to components outside the app's Text (navigation headers). */
export function headerFont(size: number): TextStyle {
  return { fontFamily: loaded ? CONDENSED_FACES[700] : undefined, fontWeight: loaded ? 'normal' : '700', fontSize: size };
}
