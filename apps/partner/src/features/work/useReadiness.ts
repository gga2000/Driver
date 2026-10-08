import { useCallback, useEffect, useState } from 'react';
import { useNetwork } from '@driver/ui';
import { onSoundState, soundState } from '@/lib/alert';
import { batterySaverOn, gpsState, onForeground, pushState, watchBattery } from '@/lib/readiness-probe';
import { readiness, type BatteryState, type GpsState, type PushState, type SoundState } from './readiness';

/** Location and push can change outside the app; re-check this often while home is open. */
const RECHECK_MS = 30_000;

/**
 * The live inputs of the readiness row (audit S-8): the network monitor the offline strip already
 * uses (P-09), location permission/services, the offer sound (the same player the offer screen and
 * "جرّب صوت الطلب" use, P-01), push permission on a phone, and the battery. Re-checked when the app
 * comes back to the front and every 30 s; `recheck()` after a fix.
 */
export function useReadiness(enabled: boolean) {
  const net = useNetwork();
  const [gps, setGps] = useState<GpsState>('ask');
  const [sound, setSound] = useState<SoundState>(() => soundState());
  const [push, setPush] = useState<PushState>('n/a');
  const [battery, setBattery] = useState<BatteryState | null>(null);
  const [saver, setSaver] = useState(false);

  const recheck = useCallback(() => {
    void gpsState().then(setGps);
    void pushState().then(setPush);
    void batterySaverOn().then(setSaver);
    setSound(soundState());
  }, []);

  useEffect(() => {
    if (!enabled) return;
    recheck();
    const id = setInterval(recheck, RECHECK_MS);
    const offFront = onForeground(recheck);
    const offSound = onSoundState(setSound);
    let stopBattery: (() => void) | null = null;
    let live = true;
    void watchBattery(setBattery).then((stop) => {
      if (live) stopBattery = stop;
      else stop?.();
    });
    return () => {
      live = false;
      clearInterval(id);
      offFront();
      offSound();
      stopBattery?.();
    };
  }, [enabled, recheck]);

  const r = readiness({ gps, net: net.state, sound, push, battery, saver });
  return { ...r, recheck, setGps, setSound };
}
