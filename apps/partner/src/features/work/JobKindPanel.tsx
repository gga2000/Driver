import { lazy, Suspense } from 'react';
import type { PartnerJob } from '@driver/contracts';

const ShopListCard = lazy(() => import('@/features/errand/ShopListCard'));

/**
 * The job screen's one slot for what a kind of order adds (دوّرلي's list; parcels next). Each kind's
 * card loads only when a job of that kind is open, so the plain food and ride jobs carry none of it.
 */
export function JobKindPanel({ job }: { job: PartnerJob }) {
  const errand = job.stops.some((s) => s.shopList);
  if (!errand) return null;
  return (
    <Suspense fallback={null}>
      <ShopListCard job={job} />
    </Suspense>
  );
}
