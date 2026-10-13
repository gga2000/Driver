import { lazy, Suspense } from 'react';
import type { PartnerJob, PartnerJobStop } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Skeleton } from '@driver/ui';
import { errandBlocks, nudgeReceipt, useReceiptRetry } from '@/features/errand/receipt-state';

const ShopListCard = lazy(() => import('@/features/errand/ShopListCard'));
const ParcelPanel = lazy(() => import('@/features/parcel/ParcelPanel'));

/**
 * The job screen's one slot for what a kind of order adds (دوّرلي's list, the parcel's tag). Each kind's
 * card loads only when a job of that kind is open, so the plain food and ride jobs carry none of it.
 */
export function JobKindPanel({ job }: { job: PartnerJob }) {
  if (job.stops.some((s) => s.shopList)) return <ErrandPanel job={job} />;
  if (job.vertical === 'parcel') {
    const stop = job.stops.find((s) => s.stopId === job.currentStopId) ?? null;
    return (
      <Suspense fallback={<Skeleton lines={3} />}>
        <ParcelPanel orderId={stop?.orderId ?? job.stops.find((s) => s.orderId)?.orderId ?? null} stop={stop} />
      </Suspense>
    );
  }
  return null;
}

function ErrandPanel({ job }: { job: PartnerJob }) {
  useReceiptRetry(job.currentStopId ?? null);
  return (
    <Suspense fallback={null}>
      <ShopListCard job={job} />
    </Suspense>
  );
}

/**
 * Before the main button completes a stop: what this kind of job still needs on the phone (a message
 * key to show), or null to go ahead. Synchronous, no server call; the server's own guard decides in the
 * end. Null for food, rides and parcels (the parcel's PIN is checked on its own panel, and the server's
 * drop-off guard refuses a door stop without it).
 */
export function jobKindBlocks(job: PartnerJob, stop: PartnerJobStop | null): MessageKey | null {
  return errandBlocks(job, stop);
}

/** Points him at the card that answers `jobKindBlocks` (the «الوصل» panel lights up once). */
export function nudgeJobKind(): void {
  nudgeReceipt();
}
