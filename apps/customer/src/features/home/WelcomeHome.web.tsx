import { useState } from 'react';
import { GOLDEN_MAP } from '@/features/track/map/credit';
import { WelcomeDrawing, type WelcomeHomeProps } from './WelcomeDrawing';
import { WelcomeSunrise } from './WelcomeSunrise';

export type { WelcomeHomeProps };

/**
 * Web: the welcome-home moment is the sunrise over the real town (map idea N4) where our map files are set
 * up; without them, or when the map can't draw (no WebGL, the file fails), the drawing of Aziziyah.
 */
export function WelcomeHome(props: WelcomeHomeProps) {
  const [failed, setFailed] = useState(false);
  return GOLDEN_MAP && !failed ? <WelcomeSunrise {...props} onFail={() => setFailed(true)} /> : <WelcomeDrawing {...props} />;
}
