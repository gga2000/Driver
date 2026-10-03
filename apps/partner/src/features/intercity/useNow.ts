import { useEffect, useState } from 'react';

/** The current time, re-rendered every `everyMs` (countdowns, "فات وقت الحركة"). */
export function useNow(everyMs = 1_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
