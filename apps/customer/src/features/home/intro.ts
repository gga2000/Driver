import { useEffect, useState } from 'react';
import { useMotionPresets } from '@driver/ui';

/**
 * Home builds itself in when the app opens (Ali's Yes, effects menu "stagger", 2026-10-07): the
 * header, the search, the tiles, what's in progress and the rest rise into place one after another,
 * `INTRO_STEP` ms apart, in under half a second. Only the first time home appears after the app
 * opens; coming back to it later just shows it. Nothing moves under reduced motion.
 */
export const INTRO_STEP = 60;

let builtThisOpen = false;

/** `rise(step)`: the entering animation for the `step`-th part of home, or undefined after the first showing. */
export function useHomeIntro() {
  const presets = useMotionPresets();
  const [intro] = useState(() => !builtThisOpen);
  useEffect(() => {
    builtThisOpen = true;
  }, []);
  return (step: number) => (intro ? presets.panelIn(step * INTRO_STEP) : undefined);
}
