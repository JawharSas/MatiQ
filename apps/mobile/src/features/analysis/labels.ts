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

const METHOD_LABELS: Record<string, string> = {
  submission: 'Submission',
  fall: 'Fall',
  ko_tko: 'KO / TKO',
  technical_superiority: 'Tech. superiority',
  points: 'Points',
  advantages: 'Advantages',
  penalties: 'Penalties',
  criteria: 'Criteria',
  decision: 'Decision',
  disqualification: 'Disqualification',
  draw: 'Draw',
};

/** How a match ended, short enough for a result pill ("Submission", "KO / TKO"). */
export function methodLabel(method: string): string {
  const known = METHOD_LABELS[method];
  if (known) return known;
  const words = method.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
