import { useEffect, useRef } from 'react';
import { POSITION_RULES } from '@driver/contracts';
import { apiErrorCode } from '@/lib/api-links';
import { useApiClient } from '@/lib/api';
import { currentFix, type Fix } from '@/lib/location';
import { reportArmed } from './arrive';
import { FixBuffer, toDeviceFix, worthSending } from './position-report';

/** How often a driver on a job reports his position (the live map moves at most every 2 s). */
export const JOB_POSITION_MS = 5_000;

/**
 * While he works a trip, report his GPS fixes with `trips.reportPositions` (maps program SP4a): each
 * fix with its own time, accuracy and heading. Fixes wait in a buffer while the network is down and go
 * out together when it returns (the API keeps late ones out of live tracking). No fix: nothing is sent —
 * never a made-up position. Mounted app-wide so it keeps going on the home tab. Background reporting
 * when the app is closed is SP1.
 */
export function useJobPositions(onJob: boolean): void {
  const client = useApiClient();
  const buffer = useRef(new FixBuffer());
  const prev = useRef<Fix | null>(null);
  useEffect(() => {
    if (!onJob) return;
    let alive = true;
    let sending = false;
    const tick = async () => {
      const fix = await currentFix(4000);
      if (!alive) return;
      if (fix && worthSending(fix)) {
        buffer.current.push(toDeviceFix(fix, prev.current));
        prev.current = fix;
      }
      if (sending || buffer.current.size === 0) return;
      sending = true;
      const batch = buffer.current.peek(POSITION_RULES.batchMax);
      try {
        const out = await client.trips.reportPositions.mutate({ fixes: batch });
        buffer.current.drop(batch.length);
        // Maps program d4: the stops whose 60 m he is inside, for the "وصلت؟" question.
        reportArmed(
          out.armed.map((a) => a.stopId),
          prev.current?.speedKmh ?? null,
          Date.now(),
        );
      } catch (err) {
        // The server answered (refused the batch): resending would fail the same way, so let it go.
        // No answer (offline, timeout): keep it for the next tick.
        if (apiErrorCode(err) !== null) buffer.current.drop(batch.length);
      } finally {
        sending = false;
      }
    };
    void tick();
    const id = setInterval(() => void tick(), JOB_POSITION_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [client, onJob]);
}
