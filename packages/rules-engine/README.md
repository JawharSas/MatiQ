# @matiq/rules-engine

Deterministic scoring for **BJJ**, **wrestling** and **MMA**.

The AI layer only *detects* timestamped events (positions, takedowns, strikes,
submission attempts, ...). Every point, advantage, round score and highlight
is computed here, so scorecards are reproducible, auditable and identical on
the device (live preview) and on the server (authoritative scorecard).

- Zero runtime dependencies; runs in React Native, Node 22+ and Deno.
- Untrusted input is validated event by event; malformed or low-confidence
  events are dropped and reported in `warnings` / `droppedEvents`.
- Point tables are data (`IBJJF_POINTS`, `FOLKSTYLE_POINTS`,
  `FREESTYLE_POINTS`, `MMA_WEIGHTS`) and can be overridden per call with
  `pointOverrides`, because federations revise values between seasons.

## Usage

```ts
import { analyzeMatch } from '@matiq/rules-engine';

const scorecard = analyzeMatch('bjj', events, {
  durationMs: 5 * 60_000,
  variant: 'ibjjf', // or 'submission_only'
  minConfidence: 0.6,
});

scorecard.result;     // { winner: 'A', method: 'points', summary: 'A wins on points (9-0)' }
scorecard.scoreLog;   // every scoring decision with its timestamp and reason
scorecard.stats;      // discipline-specific statistics
scorecard.phases;     // timeline segments (standing, guard, top control, ...)
scorecard.highlights; // clip windows for the post-match timeline and feed
```

## Disciplines and variants

| Discipline  | Variants                     | Notes |
|-------------|------------------------------|-------|
| `bjj`       | `ibjjf`, `submission_only`   | 3 s stabilisation, advantages for unstabilised positions and deep submission attempts, IBJJF penalty progression. |
| `wrestling` | `folkstyle`, `freestyle`     | Folkstyle near fall by hold duration, riding time, technical fall at 15. Freestyle exposure / step-out / grand amplitude, technical superiority at 10, criteria tie-breaks. |
| `mma`       | `unified`                    | Projected 10-point-must round scores from weighted impact (strikes by target, knockdowns, takedowns, submission threats, control). An estimate, not an official decision. |

### Event conventions

- `t` / `endT` are milliseconds from the start of the recording.
- `athlete` is `'A'` (the user, or the athlete on the left at the start) or `'B'`.
- `athlete` is the athlete performing / benefiting from an action, except on
  penalties where it is the penalised athlete.
- BJJ positions: for top positions (`mount`, `back_control`, `side_control`,
  `north_south`, `knee_on_belly`) `athlete` is the controlling athlete; for
  guards and `turtle` it is the athlete on the bottom; `standing` and
  `scramble` have no athlete.
- Wrestling `shot_attempt` is a shot that did **not** finish; takedown
  conversion is `takedowns / (takedowns + shot_attempts)`.

## Rule values

Rulebooks change. The defaults follow commonly published values (IBJJF points,
NCAA-style folkstyle with a 3-point takedown and 2/3/4 near falls, UWW
freestyle) and must be checked against the current rulebook of the
competition you train for. Override any value without a code change:

```ts
analyzeMatch('wrestling', events, {
  durationMs,
  variant: 'folkstyle',
  pointOverrides: { takedown: 2, technical_fall_margin: 15 },
});
```

## Tests

```bash
npm test --workspace @matiq/rules-engine
npm run typecheck --workspace @matiq/rules-engine
```
