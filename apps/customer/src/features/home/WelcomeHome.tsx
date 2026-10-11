import { useState } from 'react';
import { useLiteMode } from '@driver/ui';
import { nativeGolden } from '@/features/track/map/native-maplibre';
import { WelcomeDrawing, type WelcomeHomeProps } from './WelcomeDrawing';
import { WelcomeSunrise } from './WelcomeSunrise';

export type { WelcomeHomeProps };

/**
 * Phones: the welcome-home moment is the sunrise over the real town (map idea N4) where the build has the
 * native map and our map files are set up; else (Expo Go, low-data mode, the map failing) the drawing of Aziziyah.
 */
export function WelcomeHome(props: WelcomeHomeProps) {
  const [failed, setFailed] = useState(false);
  const lite = useLiteMode();
  return nativeGolden() && !lite && !failed ? <WelcomeSunrise {...props} onFail={() => setFailed(true)} /> : <WelcomeDrawing {...props} />;
}
