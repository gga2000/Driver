import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useTheme } from '@driver/ui';

/**
 * How long home's ambient movement plays each time home comes to the front (speed audit h1, Ali
 * 2026-10-08: "good work let's go ahead"). Then it holds still, so a phone left open on home draws
 * nothing (before, the drift never rested: ~31 % of a 4×-slowed CPU, speed audit round three).
 */
export const AMBIENT_PLAY_MS = 20_000;

/**
 * Whether home's slow ambient movement may run (the moon at night, the live dots, the live order's
 * picture and light): for `AMBIENT_PLAY_MS` after home comes to the front (opened, back from another
 * screen, the app back from the background), and again when `wake` changes (the live order reaching
 * a new stage), only while the person has not asked for reduced motion. Anything driven by it stops
 * where it is and carries on from there.
 */
export function useAmbient(wake?: unknown): boolean {
  const theme = useTheme();
  const [focused, setFocused] = useState(true);
  const [active, setActive] = useState(AppState.currentState !== 'background');
  const [playing, setPlaying] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  const front = focused && active && !theme.reduceMotion;
  useEffect(() => {
    if (!front) return;
    setPlaying(true);
    const rest = setTimeout(() => setPlaying(false), AMBIENT_PLAY_MS);
    return () => clearTimeout(rest);
  }, [front, wake]);
  return front && playing;
}
