import { useEffect, useRef, useState } from 'react';
import type { OwnerWalkupView } from '@driver/contracts';
import { chime, vibrate } from '@/lib/alert-sound';
import { VIBRATION } from '@/features/board/ladder';
import { emptyRing, freshIds, ringStep, type RingState } from './ring';

/** How often the cart checks whether a ticket is due a chime. */
const TICK_MS = 1_000;

/**
 * Rings the cart owner for new walk-over tickets while «طلبات الليلة» is open (ring.ts: a chime, again
 * after 30 s and 60 s while untouched). Returns the tickets that wear «جديدة».
 */
export function useWalkupRing(walkups: readonly OwnerWalkupView[], soundOn: boolean): ReadonlySet<string> {
  const state = useRef<RingState>(emptyRing());
  const waiting = useRef<string[]>([]);
  const sound = useRef(soundOn);
  sound.current = soundOn;
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const freshKey = useRef('');

  waiting.current = walkups.filter((w) => w.state === 'placed').map((w) => w.id);

  useEffect(() => {
    const step = () => {
      const now = Date.now();
      const next = ringStep(state.current, waiting.current, now);
      state.current = next.state;
      if (next.chime && sound.current) {
        chime(0.9);
        vibrate(VIBRATION.calm);
      }
      const f = freshIds(next.state, now);
      const key = [...f].sort().join(',');
      if (key !== freshKey.current) {
        freshKey.current = key;
        setFresh(f);
      }
    };
    step();
    const id = setInterval(step, TICK_MS);
    return () => clearInterval(id);
  }, []);

  return fresh;
}
