import { useEffect, useState } from 'react';

/** Wall clock that re-renders every `intervalMs` (countdowns, "in 12 min", "updated 8 s ago"). */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
