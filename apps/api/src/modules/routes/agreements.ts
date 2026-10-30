import { agreementAmountOk, type AgreementKind, type AgreementView } from '@driver/contracts';
import { haversineMeters } from '../trips/index.js';
import type { IntercityNetworkConfig, IntercityRules } from './intercity.config.js';
import type { AgreementRecord, DepartureRecord } from './model.js';

/**
 * Step 4 agreed trip prices (docs/specs/2026-10-08-agreed-trip-prices.md): where a rider may ask for
 * a pin pickup or a door drop, and the views. The service owns the states; these are the pure rules.
 */
export const AGREEMENT_RULES = {
  /** A pin pickup must lie this close to the road (garages and the corridor's points as a line). */
  pinMaxOffRouteKm: 5,
  /** A door drop must lie this close to the destination garage. */
  dropMaxKm: 25,
} as const;

type Place = { lat: number; lng: number };

/** Kilometres from `p` to the segment a–b (flat-earth inside a corridor's few hundred km is plenty). */
export function kmToSegment(p: Place, a: Place, b: Place): number {
  const kx = 111.32 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const ky = 110.57;
  const [px, py] = [(p.lng - a.lng) * kx, (p.lat - a.lat) * ky];
  const [bx, by] = [(b.lng - a.lng) * kx, (b.lat - a.lat) * ky];
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - t * bx, py - t * by);
}

/** The departure's road as a line: its garage, the corridor's meeting points and checkpoints in order, the far garage. */
export function routeLine(dep: DepartureRecord, network: IntercityNetworkConfig): Place[] {
  const from = network.garages.find((g) => g.id === dep.garageId);
  const to = destinationGarage(dep, network);
  const corridor = network.corridors.find((c) => c.id === dep.corridorId);
  if (!from || !to) return [];
  const stops = [...(corridor?.meetingPoints ?? []), ...(corridor?.checkpoints ?? [])].sort(
    (a, b) => haversineMeters(from, a) - haversineMeters(from, b),
  );
  return [from, ...stops, to];
}

/** Where the car ends: the destination city's garage (a live one first). */
export function destinationGarage(dep: DepartureRecord, network: IntercityNetworkConfig): Place | null {
  const inCity = network.garages.filter((g) => g.cityId === dep.toCityId);
  return inCity.find((g) => !g.draft) ?? inCity[0] ?? null;
}

/**
 * Null when the place may be priced: a pin pickup on the way (near the road, and outside the home
 * door area, which keeps its distance price); a door drop near the destination.
 */
export function agreementPlaceProblem(
  kind: AgreementKind,
  dep: DepartureRecord,
  place: Place,
  network: IntercityNetworkConfig,
  rules: Pick<IntercityRules, 'door'>,
): 'agreement_place_invalid' | null {
  if (kind === 'door_drop') {
    const to = destinationGarage(dep, network);
    return to && haversineMeters(place, to) / 1000 <= AGREEMENT_RULES.dropMaxKm ? null : 'agreement_place_invalid';
  }
  const line = routeLine(dep, network);
  const from = line[0];
  if (!from || line.length < 2) return 'agreement_place_invalid';
  if (haversineMeters(place, from) / 1000 <= rules.door.maxKm) return 'agreement_place_invalid';
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, kmToSegment(place, line[i - 1]!, line[i]!));
  return best <= AGREEMENT_RULES.pinMaxOffRouteKm ? null : 'agreement_place_invalid';
}

export function agreementAmountProblem(amountIqd: number): 'agreement_amount_invalid' | null {
  return agreementAmountOk(amountIqd) ? null : 'agreement_amount_invalid';
}

/** Still open: asked, priced, or accepted but not yet booked. */
export function agreementLive(a: AgreementRecord): boolean {
  return a.state === 'asked' || a.state === 'proposed' || a.state === 'accepted';
}

export function agreementView(a: AgreementRecord, riderFirstName: string | null = null): AgreementView {
  return {
    id: a.id,
    departureId: a.departureId,
    riderId: a.riderId,
    kind: a.kind,
    state: a.state,
    lat: a.lat,
    lng: a.lng,
    note: a.note,
    amountIqd: a.amountIqd,
    askedAt: a.askedAt,
    proposedAt: a.proposedAt,
    expiresAt: a.expiresAt,
    decidedAt: a.decidedAt,
    bookingId: a.bookingId,
    riderFirstName,
  };
}
