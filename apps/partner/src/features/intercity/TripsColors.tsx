import { useMemo, type ReactNode } from 'react';
import { partnerServices, type ThemeColors } from '@driver/design-tokens';
import { ThemeProvider, useTheme } from '@driver/ui';

/** The trips colours for the current scheme: `fill` brown, `on` gold, `tint` and `ink` for washes. */
export function useTripsColors() {
  const theme = useTheme();
  return partnerServices[theme.scheme === 'dark' ? 'ember' : 'sun'].trips;
}

/**
 * Buttons and slides in date brown with gold words (the drawings' «طلعنا», «وصلنا», «الراكب الجاي»):
 * the accent and ink roles re-pointed at the trips colours for what sits inside.
 */
export function TripsActions({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const trips = useTripsColors();
  const colors = useMemo<ThemeColors>(
    () => ({ ...theme.colors, accent: trips.fill, onAccent: trips.on, accentText: trips.ink, accentTint: trips.tint, inverse: trips.fill, onInverse: trips.on }),
    [theme.colors, trips],
  );
  return (
    <ThemeProvider theme={theme.name} colors={colors} fonts={theme.fonts} haptics={theme.haptic} direction={theme.direction} reduceMotion={theme.reduceMotion}>
      {children}
    </ThemeProvider>
  );
}
