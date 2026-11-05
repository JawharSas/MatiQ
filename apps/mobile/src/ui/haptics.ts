import * as Haptics from 'expo-haptics';

/**
 * Light vibrations on taps that change something (switching tabs, liking a
 * post, starting and stopping a recording, the tutorial). Off when the person
 * turns Vibration off in Accessibility; silent where the device has none.
 */
let enabled = true;

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

function run(play: () => Promise<void>): void {
  if (!enabled) return;
  try {
    play().catch(() => undefined);
  } catch {
    // No vibration motor or no native module (web preview): nothing to do.
  }
}

/** A tick, for switching between options. */
export const tapFeedback = (): void => run(() => Haptics.selectionAsync());

/** A light tap, for an action such as liking a post. */
export const pressFeedback = (): void => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

/** A firmer tap, for starting or stopping a recording. */
export const strongFeedback = (): void => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
