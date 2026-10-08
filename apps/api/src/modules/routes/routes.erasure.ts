import type { DemandPostState, RequestState } from '@driver/contracts';
import { ErasureNotReady, blurPin, type ErasureStep } from '../identity/index.js';
import { LIVE, type BookingRecord, type DemandPostRecord, type RequestPlaceRecord, type RequestRecord } from './model.js';
import type { RoutesRepository } from './routes.repository.js';

const OPEN_DEMAND: readonly DemandPostState[] = ['open', 'claimed'];
const OPEN_REQUEST: readonly RequestState[] = ['open', 'matched', 'driver_arrived'];

/**
 * W7 account deletion, the الرجعة part (docs/api/account-deletion.md). A seat still held or booked, a
 * ride request or a seat request still waiting stops the deletion. Afterwards his bookings and
 * requests stay (money, the driver's record) but their door pickups and places are blurred, notes
 * dropped, and his written review is taken down (his stars still count for the driver).
 */
export function routesErasure(repo: RoutesRepository): ErasureStep {
  const open = async (personId: string) => {
    const [bookings, demand, requests] = await Promise.all([
      repo.bookingsOfRider(personId, LIVE),
      repo.listDemand({ riderId: personId, states: OPEN_DEMAND }),
      repo.listRequests({ riderId: personId, states: OPEN_REQUEST }),
    ]);
    return bookings.length + demand.length + requests.length;
  };
  return {
    owner: 'routes',
    tables: ['public.seat_bookings', 'public.demand_posts', 'public.ride_requests'],
    blockers: async (personId) => {
      const n = await open(personId);
      return n > 0 ? [{ kind: 'open_booking', count: n }] : [];
    },
    erase: async (personId) => {
      if ((await open(personId)) > 0) throw new ErasureNotReady('a booking is still open');
      for (const b of await repo.bookingsOfRider(personId)) await repo.saveBooking(blurBooking(b));
      for (const p of await repo.listDemand({ riderId: personId })) await repo.saveDemand(blurDemand(p));
      for (const r of await repo.listRequests({ riderId: personId })) await repo.saveRequest(blurRequest(r));
    },
  };
}

function blurBooking(b: BookingRecord): BookingRecord {
  const pin = blurPin(b.pickup);
  return { ...b, pickup: { ...b.pickup, lat: pin.lat, lng: pin.lng, note: null }, review: null };
}

function blurDemand(p: DemandPostRecord): DemandPostRecord {
  return p.pickup.kind === 'door' ? { ...p, pickup: { kind: 'door', ...blurPin(p.pickup) } } : p;
}

function blurPlace(p: RequestPlaceRecord): RequestPlaceRecord {
  // A garage is public; anything else he typed or pinned is his.
  if (p.garageId) return p;
  return { label: '', ...(p.lat !== undefined && p.lng !== undefined ? blurPin({ lat: p.lat, lng: p.lng }) : {}) };
}

function blurRequest(r: RequestRecord): RequestRecord {
  return { ...r, from: blurPlace(r.from), to: blurPlace(r.to), note: null, driverArrivedPin: r.driverArrivedPin ? blurPin(r.driverArrivedPin) : null };
}
