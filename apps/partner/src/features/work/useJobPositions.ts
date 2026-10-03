import { useEffect, useRef } from 'react';
import { useApiClient } from '@/lib/api';
import { currentFix } from '@/lib/location';

/** How often a driver on a job reports his position (the customer's map polls every 2 s). */
export const JOB_POSITION_MS = 5_000;

/**
 * While he works a trip, report his GPS fix with `trips.reportPosition` (every active trip of his):
 * the customer's live map, the kitchen's "الدليفري جاي بعد 4 د" and the stop geofences all read the
 * trip's trail, which nothing else feeds. No fix (desktop browser, permission refused): nothing is
 * sent — never a made-up position. Mounted app-wide so it keeps going on the home tab.
 * TODO(background-location): a TaskManager task takes this over when the app is backgrounded.
 */
export function useJobPositions(onJob: boolean): void {
  const client = useApiClient();
  const last = useRef<{ lat: number; lng: number; at: number } | null>(null);
  useEffect(() => {
    if (!onJob) return;
    let alive = true;
    const send = async () => {
      const fix = await currentFix(4000);
      if (!alive || !fix) return;
      const at = Date.now();
      const prev = last.current;
      const speedKmh = prev && at > prev.at ? Math.min(120, (metres(prev, fix) / ((at - prev.at) / 1000)) * 3.6) : undefined;
      const bearing = prev && metres(prev, fix) > 5 ? bearingOf(prev, fix) : undefined;
      last.current = { ...fix, at };
      await client.trips.reportPosition
        .mutate({ pin: fix, at: new Date(at), ...(speedKmh !== undefined ? { speedKmh } : {}), ...(bearing !== undefined ? { bearing } : {}) })
        .catch(() => undefined);
    };
    void send();
    const id = setInterval(() => void send(), JOB_POSITION_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [client, onJob]);
}

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const k = 111_320;
  return Math.hypot((b.lng - a.lng) * k * Math.cos((a.lat * Math.PI) / 180), (b.lat - a.lat) * k);
}

/** Degrees clockwise from north, 0–360. */
export function bearingOf(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(r(b.lng - a.lng)) * Math.cos(r(b.lat));
  const x = Math.cos(r(a.lat)) * Math.sin(r(b.lat)) - Math.sin(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(r(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
