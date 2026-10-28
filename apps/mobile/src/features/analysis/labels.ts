/**
 * Display helpers for rules-engine labels. Phase and highlight labels refer
 * to the fighters as "A" and "B" (e.g. "Guard play (A on top)", "A riding");
 * the dashboard shows the fighters' names instead.
 */

export type FighterNames = { A: string; B: string };

/** Replaces the standalone fighter letters with names. */
export function withNames(label: string, names: FighterNames): string {
  return label.replace(/\b([AB])\b/g, (letter) => names[letter as 'A' | 'B']);
}

/**
 * For lists that already show the fighter's name in front of the label:
 * drops a leading fighter letter ("A flurry: 7 strikes" -> "Flurry: 7
 * strikes"), names any other letter and capitalises the first character.
 */
export function highlightText(label: string, athlete: 'A' | 'B' | null, names: FighterNames): string {
  const trimmed = athlete && label.startsWith(`${athlete} `) ? label.slice(2) : label;
  const named = withNames(trimmed, names);
  return named.charAt(0).toUpperCase() + named.slice(1);
}
