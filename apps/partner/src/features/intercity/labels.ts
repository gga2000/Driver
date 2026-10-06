import type { DriverBookingRow, IntercityDepartureState, IntercitySeatId, RequestState, TravellingAs } from '@driver/contracts';
import { formatMinutes, formatRange, type MessageKey } from '@driver/i18n';
import type { TFn } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { pluralForm } from '@/features/work/logic';
import { clockBare, clockLabel, dayOffset, dayPeriod, minutesUntil, windowLabel, type DepartBlockerNote, type LegendState, type RiderStatus } from './logic';

/** Copy helpers for the intercity screens (every string from @driver/i18n). */

export function cityName(t: TFn, cityId: string): string {
  if (cityId === 'baghdad') return t('rajaa.city_baghdad');
  if (cityId === 'kut') return t('rajaa.city_kut');
  return t('rajaa.city_aziziyah');
}

/** "7:30 الصبح". */
export function timeWithPeriod(t: TFn, at: Date): string {
  return `${clockBare(at)} ${t(`partner.ic_period_${dayPeriod(at)}` as MessageKey)}`;
}

/** "اليوم · الصبح" / "باچر · المغرب" (under a big clock). */
export function dayAndPeriod(t: TFn, at: Date, now: Date): string {
  return `${dayName(t, at, now)} · ${t(`partner.ic_period_${dayPeriod(at)}` as MessageKey)}`;
}

function dayName(t: TFn, at: Date, now: Date): string {
  const d = dayOffset(at, now);
  return d <= 0 ? t('partner.ic_day_today') : d === 1 ? t('partner.ic_day_tomorrow') : t('partner.ic_day_later');
}

/** "اليوم الساعة 7:30 الصبح" / "باچر الساعة …". */
export function whenLabel(t: TFn, at: Date, now: Date): string {
  const day = dayName(t, at, now);
  return t('partner.ic_when', { day, time: clockBare(at), period: t(`partner.ic_period_${dayPeriod(at)}` as MessageKey) });
}

/** "7:00–8:00 م" in one piece, the start on the right where an Arabic reader begins (`formatRange`). */
export function windowText(start: Date, end: Date): string {
  const [from = '', to = ''] = windowLabel(start, end).split('–');
  // Word joiners keep "7:00–8:00" on one line.
  return formatRange(`${from}\u2060`, `\u2060${to}`);
}

export function demandLine(t: TFn, n: number, start: Date, end: Date): string {
  const form = pluralForm(n);
  const window = windowText(start, end);
  if (form === 'one') return t('partner.ic_demand_one', { window });
  if (form === 'many') return t('partner.ic_demand_many', { n, window });
  return t('partner.ic_demand_few', { n, window });
}

export function departureState(t: TFn, s: IntercityDepartureState): string {
  return t(`partner.ic_dep_state_${s}` as MessageKey);
}

/** "تطلع بعد 12 دقيقة" / "بعد ساعة و20 دقيقة" / "وقت الحركة هسة" / "فات وقت الحركة بـ 9 دقيقة". */
export function countdownLabel(t: TFn, departAt: Date, now: Date): string {
  const m = minutesUntil(departAt, now);
  if (m < 0) return t('partner.ic_dep_late', { n: -m });
  if (m === 0) return t('partner.ic_dep_now');
  if (m >= 60) return t('partner.ic_dep_in_hours', { duration: formatMinutes(m) });
  return t('partner.ic_dep_in', { n: m });
}

export function travellingAsLabel(t: TFn, v: TravellingAs): string {
  return t(`intercity.travelling_as_${v}` as MessageKey);
}

export function seatName(t: TFn, id: IntercitySeatId): string {
  return t(`seat.${id}` as MessageKey);
}

export function seatsList(t: TFn, ids: readonly IntercitySeatId[]): string {
  return ids.map((id) => seatName(t, id)).join('، ');
}

export function riderName(t: TFn, firstName: string | null | undefined): string {
  return firstName || t('partner.ic_rider_unnamed');
}

export function statusLabel(t: TFn, s: RiderStatus, b: Pick<DriverBookingRow, 'meterMinutes'>): string {
  if (s === 'late') return t('partner.ic_status_late', { n: b.meterMinutes ?? 0 });
  return t(`partner.ic_status_${s}` as MessageKey);
}

export function paymentLabel(t: TFn, b: Pick<DriverBookingRow, 'state' | 'prepayRail' | 'totalIqd'>): string {
  if (b.state === 'held' || !b.prepayRail) return t('partner.ic_pay_unpaid');
  if (b.prepayRail === 'wallet') return t('partner.ic_pay_wallet');
  if (b.prepayRail === 'trusted_cash') return t('partner.ic_pay_trusted');
  return t('partner.ic_pay_cash', { amount: amountParam(b.totalIqd) });
}

export function pickupLabel(t: TFn, b: Pick<DriverBookingRow, 'pickup'>): string {
  if (b.pickup.kind === 'meeting_point') return t('partner.ic_pickup_mp', { place: b.pickup.nameAr ?? '' });
  if (b.pickup.kind === 'door') return t('partner.ic_pickup_door');
  return t('partner.ic_pickup_garage');
}

export function seatsCount(t: TFn, n: number): string {
  const form = pluralForm(n);
  if (form === 'one') return t('partner.ic_req_seats_one');
  if (form === 'many') return t('partner.ic_req_seats_many', { n });
  return t('partner.ic_req_seats_few', { n });
}

export function childrenCount(t: TFn, n: number): string {
  const form = pluralForm(n);
  if (form === 'one') return t('partner.kh_children_one');
  if (form === 'many') return t('partner.kh_children_many', { n });
  return t('partner.kh_children_few', { n });
}

/** The locked "انطلقنا" slide's note (garage mode): "3 ركاب بعدهم" / the door pickup / the time. */
export function blockerText(t: TFn, note: DepartBlockerNote, departAt: Date): string | null {
  if (!note) return null;
  if (note.kind === 'riders') return t('partner.gm_block_riders', { n: note.n });
  if (note.kind === 'pickup') return t('partner.gm_block_pickup');
  return t('partner.gm_block_early', { time: clockLabel(departAt) });
}

/** Legend words for the seat states on the garage map. */
export function legendLabel(t: TFn, s: LegendState): string {
  if (s === 'free') return t('partner.ic_seat_free');
  if (s === 'walkup') return t('partner.ic_seat_walkup');
  if (s === 'late') return t('partner.gm_legend_late');
  return t(`partner.ic_status_${s}` as MessageKey);
}

export function rideState(t: TFn, s: RequestState): string {
  return t(`partner.ic_ride_state_${s}` as MessageKey);
}
