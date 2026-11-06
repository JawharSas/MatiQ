/**
 * Fighter 1's numbers from a match's scorecard stats, the same for every
 * sport. Fighter 1 is "you" in the match setup. Stats a sport doesn't have
 * (sweeps in wrestling, say) count as 0; missing or malformed stats give
 * zeros too.
 */

export interface AthleteNumbers {
  takedowns: number;
  submissionAttempts: number;
  guardPasses: number;
  sweeps: number;
  /** Time in control: top control (BJJ), riding time (wrestling), control time (MMA). */
  controlMs: number;
}

const ZERO: AthleteNumbers = { takedowns: 0, submissionAttempts: 0, guardPasses: 0, sweeps: 0, controlMs: 0 };

type Bag = Record<string, unknown>;

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);
const bag = (value: unknown): Bag => (value && typeof value === 'object' ? (value as Bag) : {});
/** `stats.takedowns.A` style (BJJ, wrestling). */
const forA = (stats: Bag, key: string): number => num(bag(stats[key]).A);

export function athleteNumbers(discipline: string, stats: unknown): AthleteNumbers {
  const s = bag(stats);
  switch (discipline) {
    case 'bjj':
      return {
        takedowns: forA(s, 'takedowns'),
        submissionAttempts: forA(s, 'submissionAttempts'),
        guardPasses: forA(s, 'guardPasses'),
        sweeps: forA(s, 'sweeps'),
        controlMs: forA(s, 'topControlMs'),
      };
    case 'wrestling':
      return { ...ZERO, takedowns: forA(s, 'takedowns'), controlMs: forA(s, 'controlMs') };
    case 'mma': {
      const a = bag(s.A);
      return { ...ZERO, takedowns: num(a.takedownsLanded), submissionAttempts: num(a.submissionAttempts), controlMs: num(a.controlMs) };
    }
    default:
      return { ...ZERO };
  }
}
