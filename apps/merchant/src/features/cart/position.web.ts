import { useEffect, useState } from 'react';
import type { HereState } from './position';

export type { HereState } from './position';

/** Web: the browser's position once, asked when the open screen shows (no answer in 8 s = none). */
export function useHere(): HereState {
  const [here, setHere] = useState<HereState>(() => (typeof navigator !== 'undefined' && navigator.geolocation ? { state: 'asking' } : { state: 'none' }));
  useEffect(() => {
    if (here.state !== 'asking') return;
    let live = true;
    navigator.geolocation.getCurrentPosition(
      (p) => live && setHere({ state: 'here', at: { lat: p.coords.latitude, lng: p.coords.longitude } }),
      () => live && setHere({ state: 'none' }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
    return () => {
      live = false;
    };
  }, [here.state]);
  return here;
}
