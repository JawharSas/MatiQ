/**
 * In-app accessibility settings: text size, high contrast and reduced motion.
 *
 * They add to the phone's own settings, which MatIQ always follows (font size
 * and display size, TalkBack / VoiceOver, "Remove animations" / Reduce
 * Motion). Stored on this device only, like other UI preferences.
 */

import { createContext, type ReactNode, use, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { readPreference, writePreference } from '@/lib/storage';

export const TEXT_SIZES = ['default', 'large', 'larger', 'largest'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

/** Multiplier on top of the phone's font size. */
export const TEXT_SCALE: Record<TextSize, number> = { default: 1, large: 1.15, larger: 1.3, largest: 1.5 };

export const MOTION_PREFERENCES = ['system', 'reduce', 'full'] as const;
export type MotionPreference = (typeof MOTION_PREFERENCES)[number];

const ON_OFF = ['on', 'off'] as const;

export interface A11ySettings {
  textSize: TextSize;
  textScale: number;
  highContrast: boolean;
  motion: MotionPreference;
  /** True when animations should be avoided (phone setting or in-app choice). */
  reduceMotion: boolean;
  setTextSize(size: TextSize): void;
  setHighContrast(on: boolean): void;
  setMotion(motion: MotionPreference): void;
}

const DEFAULTS: A11ySettings = {
  textSize: 'default',
  textScale: 1,
  highContrast: false,
  motion: 'system',
  reduceMotion: false,
  setTextSize: () => undefined,
  setHighContrast: () => undefined,
  setMotion: () => undefined,
};

const A11yContext = createContext<A11ySettings>(DEFAULTS);

export function A11yProvider({ children }: { children: ReactNode }) {
  const [textSize, setTextSize] = useState<TextSize>(() => readPreference('a11y-text-size', TEXT_SIZES, 'default'));
  const [highContrast, setHighContrast] = useState(() => readPreference('a11y-high-contrast', ON_OFF, 'off') === 'on');
  const [motion, setMotion] = useState<MotionPreference>(() => readPreference('a11y-motion', MOTION_PREFERENCES, 'system'));
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setSystemReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystemReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const value = useMemo<A11ySettings>(
    () => ({
      textSize,
      textScale: TEXT_SCALE[textSize],
      highContrast,
      motion,
      reduceMotion: motion === 'reduce' || (motion === 'system' && systemReduceMotion),
      setTextSize: (size) => {
        writePreference('a11y-text-size', size);
        setTextSize(size);
      },
      setHighContrast: (on) => {
        writePreference('a11y-high-contrast', on ? 'on' : 'off');
        setHighContrast(on);
      },
      setMotion: (next) => {
        writePreference('a11y-motion', next);
        setMotion(next);
      },
    }),
    [textSize, highContrast, motion, systemReduceMotion],
  );

  return <A11yContext value={value}>{children}</A11yContext>;
}

/** Current settings; the defaults apply outside the provider (start-up screens). */
export function useA11y(): A11ySettings {
  return use(A11yContext);
}
