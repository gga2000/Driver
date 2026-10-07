import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useTheme } from '@driver/ui';

/**
 * Whether home's slow ambient movement may run (the food tile's drifting light, the moon at night):
 * only while home is the screen in front, the app is in the foreground and the person has not asked
 * for reduced motion. Anything driven by it stops where it is and carries on from there.
 */
export function useAmbient(): boolean {
  const theme = useTheme();
  const [focused, setFocused] = useState(true);
  const [active, setActive] = useState(AppState.currentState !== 'background');
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
  return focused && active && !theme.reduceMotion;
}
