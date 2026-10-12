import { lazy, Suspense } from 'react';
import type { PartnerJob, PartnerJobStop } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { errandBlocks, nudgeReceipt, useReceiptRetry } from '@/features/errand/receipt-state';

const ShopListCard = lazy(() => import('@/features/errand/ShopListCard'));

/**
 * The job screen's one slot for what a kind of order adds (دوّرلي's list; parcels next). Each kind's
 * card loads only when a job of that kind is open, so the plain food and ride jobs carry none of it.
 */
export function JobKindPanel({ job }: { job: PartnerJob }) {
  const errand = job.stops.some((s) => s.shopList);
  if (!errand) return null;
  return <ErrandPanel job={job} />;
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
 * end. Null for food, rides and parcels.
 */
export function jobKindBlocks(job: PartnerJob, stop: PartnerJobStop | null): MessageKey | null {
  return errandBlocks(job, stop);
}

/** Points him at the card that answers `jobKindBlocks` (the «الوصل» panel lights up once). */
export function nudgeJobKind(): void {
  nudgeReceipt();
}
