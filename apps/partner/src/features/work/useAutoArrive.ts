import { useEffect, useRef, useState } from 'react';
import { dismissArrival, NO_WATCH, useArmed, watchArrival, type ArriveWatch } from './arrive';

/** Re-checked this often while a stop is open (the question needs 10 s of standing still). */
const TICK_MS = 1_000;

/**
 * Whether to ask "وصلت؟" for the current stop (maps program d4) and the "مو بعد" answer. Reads the
 * position reporter's latest `armed` answer; asking never arrives on its own.
 */
export function useAutoArrive(stopId: string | null, pending: boolean): { ask: boolean; notYet: () => void } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!stopId || !pending) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [stopId, pending]);
  const reported = useArmed(now);
  const watch = useRef<ArriveWatch>(NO_WATCH);
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    const r = watchArrival(watch.current, { stopId, pending, armed: reported.armed, speedKmh: reported.speedKmh, now });
    watch.current = r.watch;
    setAsk(r.ask);
  }, [now, stopId, pending, reported]);
  return {
    ask,
    notYet: () => {
      if (stopId) watch.current = dismissArrival(watch.current, stopId);
      setAsk(false);
    },
  };
}
