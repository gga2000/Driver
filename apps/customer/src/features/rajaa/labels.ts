import type { BookingState, IntercityDirection, IntercitySeatId, IntercityVehicle, PrepayRail, RequestState, TravellingAs } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { ltr, type IconName } from '@driver/ui';
import type { TFn } from '@/lib/i18n';
import { countKey } from '@/lib/plural';
import type { SeatFit } from './fit';
import { endpoints } from './logic';

/** Copy helpers shared by the الرجعة screens (all strings come from @driver/i18n). */

export function cityName(t: TFn, cityId: string): string {
  if (cityId === 'baghdad') return t('rajaa.city_baghdad');
  if (cityId === 'kut') return t('rajaa.city_kut');
  return t('rajaa.city_aziziyah');
}

/** "بغداد ← العزيزية". */
export function routeLabel(t: TFn, corridorCityId: string, direction: IntercityDirection): string {
  const e = endpoints(corridorCityId, direction);
  return t('rajaa.route', { from: cityName(t, e.from), to: cityName(t, e.to) });
}

export const TRAVELLING_AS: readonly TravellingAs[] = ['rijal', 'nisa', 'aila'];

/** Each traveller type gets its own figure (joy S2-09): رجال a man, نساء a woman in a headscarf, عائلة a family. */
export const TRAVELLING_AS_ICON: Readonly<Record<TravellingAs, IconName>> = { rijal: 'user', nisa: 'woman', aila: 'family' };

export function travellingAsLabel(t: TFn, v: TravellingAs): string {
  return t(`intercity.travelling_as_${v}` as MessageKey);
}

export function seatName(t: TFn, id: IntercitySeatId): string {
  return t(`seat.${id}` as MessageKey);
}

export function seatsList(t: TFn, ids: readonly IntercitySeatId[]): string {
  return ids.map((id) => seatName(t, id)).join('، ');
}

/** "صالون · كامري بيضاء · ⁦12345 بغداد⁩". */
export function vehicleLine(t: TFn, v: IntercityVehicle): string {
  const kind = t(`rajaa.vehicle_${v.kind}` as MessageKey);
  const desc = [v.model, v.color].filter(Boolean).join(' ');
  return [kind, desc || null, plate(v.plate)].filter(Boolean).join(' · ');
}

/** "صالون · سوناتا بيضاء": the car without its plate (the plate gets its own chip, audit C-20). */
export function vehicleDesc(t: TFn, v: IntercityVehicle): string {
  const kind = t(`rajaa.vehicle_${v.kind}` as MessageKey);
  const desc = [v.model, v.color].filter(Boolean).join(' ');
  return [kind, desc || null].filter(Boolean).join(' · ');
}

/** Iraqi plates mix digits and the province name ("12345 بغداد"): shown as written, isolated only when all Latin/digits. */
export function plate(p: string): string {
  return /^[\x20-\x7E]+$/.test(p) ? ltr(p) : p;
}

/** Last four of a person id, as a stand-in until driver names reach the board. */
export function shortId(id: string): string {
  return ltr(id.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase());
}

/** Short driver label until names exist on the board: "السايق #A1B2". */
export function driverLabel(t: TFn, driverId: string): string {
  return t('rajaa.driver', { id: shortId(driverId) });
}

export { windowLabel } from './logic';

/** "مقعد واحد" / "مقعدين" / "3 مقاعد". */
export function seatsCount(t: TFn, n: number): string {
  if (n === 1) return t('rajaa.seats_one');
  if (n === 2) return t('rajaa.seats_two');
  return t('demand.seats', { n });
}

/** Request-board time chip: "8 الصبح", "4 العصر"… (no bare 8:00 that could be morning or night). */
export function slotLabel(t: TFn, hour: number): string {
  return t(`rajaa.slot_${hour}` as MessageKey);
}

export function prepayLabel(t: TFn, rail: PrepayRail): string {
  if (rail === 'wallet') return t('intercity.prepay_wallet');
  if (rail === 'trusted_cash') return t('intercity.prepay_trusted');
  return t('intercity.prepay_cash');
}

export function bookingStateLabel(t: TFn, s: BookingState): string {
  return t(`rajaa.booking_state_${s}` as MessageKey);
}

export function requestStateLabel(t: TFn, s: RequestState): string {
  return t(`rajaa.req_state_${s}` as MessageKey);
}

/** "باقي 3 مقاعد" / "باقي مقعد واحد" / "كاملة". */
export function seatsLeftLabel(t: TFn, free: number): string {
  if (free <= 0) return t('intercity.full');
  if (free === 1) return t('intercity.last_seat');
  return t('intercity.seats_left', { n: free });
}

/** Seats for you (r1): "باقي مقعد إلك" / "باقي 3 مقاعد إلك" / "المقعد الباقي ما يناسبك" / "كاملة". */
export function fitLabel(t: TFn, fit: SeatFit): string {
  if (fit.kind === 'full') return t('intercity.full');
  if (fit.kind === 'none_fit') return fit.free === 1 ? t('rajaa.fit_none_one') : t('rajaa.fit_none');
  return t(countKey('rajaa.fit_seats', fit.n), { n: fit.n });
}

/** Why the seats left don't suit the rider (one line under the pill). */
export function fitReason(t: TFn, reason: 'adjacency' | 'family_only'): string {
  return t(reason === 'family_only' ? 'rajaa.fit_reason_family_only' : 'rajaa.fit_reason_adjacency');
}
