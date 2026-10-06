import { useEffect, useState } from 'react';
import type { Timetable } from '@driver/contracts';
import { timetablePref } from './timetable-pref';

/** The person's Ramadan timetable, live (null until picked), and the way to pick it. */
export function useTimetable(): [Timetable | null, (v: Timetable) => void] {
  const [pick, setPick] = useState(timetablePref.current);
  useEffect(() => {
    void timetablePref.load();
    return timetablePref.subscribe(setPick);
  }, []);
  return [pick, (v: Timetable) => void timetablePref.set(v)];
}
