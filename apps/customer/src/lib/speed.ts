import Constants from 'expo-constants';
import { useNavigationContainerRef } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { createScreenSpeed, createSpeedReporter } from '@driver/contracts/speed-report';

const dev = typeof __DEV__ !== 'undefined' && __DEV__;

/**
 * Speed reports from real phones (speed audit g2; docs/deploy/hosting.md, "Logs and errors"): how
 * long the app takes to start and each screen to open, sent to Sentry's performance view with the
 * crash reports' DSN. Off until `EXPO_PUBLIC_SENTRY_DSN` is set, never in development, and then only
 * 1 app session in 10 reports (`EXPO_PUBLIC_SPEED_SAMPLE`, 0–1). Route patterns only, nothing personal.
 */
const speedReporter = createSpeedReporter({
  dsn: dev ? undefined : process.env.EXPO_PUBLIC_SENTRY_DSN,
  sampleRate: process.env.EXPO_PUBLIC_SPEED_SAMPLE,
  environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT || 'production',
  release: process.env.EXPO_PUBLIC_APP_RELEASE || `iq.driver.customer@${Constants.expoConfig?.version ?? '0.0.0'}`,
  app: 'customer',
  os: Platform.OS,
});
const screenSpeed = createScreenSpeed(speedReporter);

/**
 * For the root navigator: `segments` are the current route's, `shown` turns true when the splash
 * lifts (the app start ends on the first screen drawn after that).
 */
export function useScreenSpeed(segments: readonly string[], shown: boolean): void {
  const nav = useNavigationContainerRef();
  useEffect(() => {
    if (!speedReporter.enabled) return;
    // Fires when a navigation is asked for, before the next screen renders: the screen's start.
    return nav.addListener('__unsafe_action__', () => screenSpeed.onNavigate());
  }, [nav]);
  const key = segments.join('/');
  useEffect(() => {
    if (shown) screenSpeed.onRoute(key.split('/'));
  }, [key, shown]);
}
