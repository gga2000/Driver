import { lazy, Suspense } from 'react';
import type { PartnerJob } from '@driver/contracts';
import { Skeleton } from '@driver/ui';

/**
 * The job screen's one slot for what only some kinds of order need, under the job's notes. Each kind's
 * panel lives in its own feature folder and loads only when a job of that kind is open. Every other kind
 * (food, rides, …) draws nothing here.
 */
const ParcelPanel = lazy(() => import('@/features/parcel/ParcelPanel'));

export function JobKindPanel({ job }: { job: PartnerJob }) {
  const stop = job.stops.find((s) => s.stopId === job.currentStopId) ?? null;
  switch (job.vertical) {
    case 'parcel':
      return (
        <Suspense fallback={<Skeleton lines={3} />}>
          <ParcelPanel orderId={stop?.orderId ?? job.stops.find((s) => s.orderId)?.orderId ?? null} stop={stop} />
        </Suspense>
      );
    default:
      return null;
  }
}
