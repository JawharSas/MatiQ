/**
 * Ranked tiers. Each tier pairs a ladder name with a belt colour, from
 * Bronze / White Belt to Grandmaster / Black Belt. Every tier below
 * Grandmaster has three divisions (III -> II -> I) of 50 rating points; a new
 * fighter starts at 1000 (Bronze I) and is "in placement" for 5 matches.
 */

export const TIERS = [
  { id: 'bronze', name: 'Bronze', belt: 'White Belt', min: 0 },
  { id: 'silver', name: 'Silver', belt: 'Blue Belt', min: 1050 },
  { id: 'gold', name: 'Gold', belt: 'Purple Belt', min: 1200 },
  { id: 'platinum', name: 'Platinum', belt: 'Brown Belt', min: 1350 },
  { id: 'grandmaster', name: 'Grandmaster', belt: 'Black Belt', min: 1500 },
] as const;

export type TierId = (typeof TIERS)[number]['id'];
export type Division = 'III' | 'II' | 'I';

export const PLACEMENT_MATCHES = 5;
const DIVISION_SIZE = 50;

export interface TierStanding {
  tier: TierId;
  name: string;
  belt: string;
  division: Division | null;
  /** e.g. "Gold II" or "Grandmaster". */
  label: string;
  /** Rating at which the next division or tier starts; null at the top. */
  nextAt: number | null;
  /** Progress through the current division, in [0, 1]. */
  progress: number;
  /** Still in placement matches (rating moves fast, tier is provisional). */
  placement: boolean;
  placementRemaining: number;
}

export function tierFor(rating: number, games = PLACEMENT_MATCHES): TierStanding {
  let index = 0;
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (rating >= TIERS[i]!.min) {
      index = i;
      break;
    }
  }
  const tier = TIERS[index]!;
  const next = TIERS[index + 1];
  const placementRemaining = Math.max(0, PLACEMENT_MATCHES - games);
  const placement = placementRemaining > 0;

  if (!next) {
    return { tier: tier.id, name: tier.name, belt: tier.belt, division: null, label: tier.name, nextAt: null, progress: 1, placement, placementRemaining };
  }

  // Divisions sit in the last 150 points below the next tier: III, II, I.
  // Bronze III also covers everything below 900 (its progress reads 0 there).
  const divisions: Division[] = ['III', 'II', 'I'];
  const starts = [next.min - 3 * DIVISION_SIZE, next.min - 2 * DIVISION_SIZE, next.min - DIVISION_SIZE];
  const d = rating >= starts[2]! ? 2 : rating >= starts[1]! ? 1 : 0;
  const start = starts[d]!;
  const end = start + DIVISION_SIZE;
  const progress = Math.min(1, Math.max(0, (rating - start) / DIVISION_SIZE));
  const division = divisions[d]!;
  return {
    tier: tier.id,
    name: tier.name,
    belt: tier.belt,
    division,
    label: `${tier.name} ${division}`,
    nextAt: end,
    progress,
    placement,
    placementRemaining,
  };
}
