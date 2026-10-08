import type {
  CorridorView,
  DriverDepartureView,
  IntercityDepartureState,
  IntercityDirection,
  IntercityVehicle,
  OverdueDeparture,
  VehicleModelKey,
} from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';

/**
 * الرجعة garage board (W3 / NTF-14 Console side): today's departures from one garage, the late
 * ones (`routes.ops.overdueDepartures`) pinned on top with their way out. Pure helpers here.
 */

const MODEL_KEY: Record<VehicleModelKey, MessageKey> = {
  elantra: 'vehicle.model_elantra',
  corolla: 'vehicle.model_corolla',
  cerato: 'vehicle.model_cerato',
  sonata: 'vehicle.model_sonata',
  accent: 'vehicle.model_accent',
  tahoe: 'vehicle.model_tahoe',
  gmc: 'vehicle.model_gmc',
  starex: 'vehicle.model_starex',
  other: 'vehicle.model_other',
};

/** «إلنترا بيضة» from the listed model (or the driver's own words) and colour. */
export function vehicleLabel(v: Pick<IntercityVehicle, 'modelKey' | 'model' | 'color'>): string {
  const model = v.modelKey && v.modelKey !== 'other' ? t(MODEL_KEY[v.modelKey]) : (v.model?.trim() ?? '');
  return [model, v.color?.trim()].filter(Boolean).join(' ');
}

/** «العزيزية ← بغداد» for a corridor «العزيزية ⇄ بغداد» in a direction (RTL: the arrow points where the car goes). */
export function routeLabel(corridor: Pick<CorridorView, 'nameAr'> | undefined, direction: IntercityDirection): string {
  if (!corridor) return '';
  const [home, far] = corridor.nameAr.split('⇄').map((s) => s.trim());
  if (!home || !far) return corridor.nameAr;
  return direction === 'from_aziziyah' ? `${home} ← ${far}` : `${far} ← ${home}`;
}

export type BoardTone = 'bad' | 'warn' | 'ready' | 'live' | 'done' | 'neutral';

/** The state chip on a board row; a late departure overrides it with its overdue reason. */
export function stateChip(state: IntercityDepartureState, late: OverdueDeparture | undefined): { key: MessageKey; tone: BoardTone } {
  if (late) return late.reason === 'driver_no_show' ? { key: 'console.garage.late_no_show', tone: 'bad' } : { key: 'console.garage.late_not_arrived', tone: 'warn' };
  switch (state) {
    case 'scheduled':
      return { key: 'console.garage.state_scheduled', tone: 'neutral' };
    case 'boarding':
      return { key: 'console.garage.state_boarding', tone: 'ready' };
    case 'departed':
      return { key: 'console.garage.state_departed', tone: 'live' };
    case 'arrived':
      return { key: 'console.garage.state_arrived', tone: 'done' };
    case 'closed':
      return { key: 'console.garage.state_closed', tone: 'done' };
    default:
      return { key: 'console.garage.state_cancelled', tone: 'neutral' };
  }
}

/** Finished or cancelled runs sink to the bottom of the board, dimmed. */
export function isOver(state: IntercityDepartureState): boolean {
  return state === 'closed' || state === 'cancelled_by_driver' || state === 'cancelled_low_fill';
}

/** Board order: live runs by departure time, then finished ones (latest first). */
export function sortBoard(deps: readonly DriverDepartureView[]): DriverDepartureView[] {
  return [...deps].sort((a, b) => {
    const oa = isOver(a.state) ? 1 : 0;
    const ob = isOver(b.state) ? 1 : 0;
    if (oa !== ob) return oa - ob;
    return oa ? b.departAt.getTime() - a.departAt.getTime() : a.departAt.getTime() - b.departAt.getTime();
  });
}

/** Seat dots: booked (riders), held (10-minute holds), walk-ups that count, and free. */
export function seatDots(d: Pick<DriverDepartureView, 'fill'>): ('booked' | 'held' | 'walkup' | 'free')[] {
  const { seatsTotal, booked, held, walkUpsCounted } = d.fill;
  const out: ('booked' | 'held' | 'walkup' | 'free')[] = [];
  for (let i = 0; i < booked; i++) out.push('booked');
  for (let i = 0; i < walkUpsCounted; i++) out.push('walkup');
  for (let i = 0; i < held; i++) out.push('held');
  while (out.length < seatsTotal) out.push('free');
  return out.slice(0, Math.max(seatsTotal, 0));
}

/** The way out a staff action leads to; `close` is offered on an arrived run that has not closed yet. */
export type GarageAction = 'cancel' | 'arrive' | 'close';

export function actionFor(state: IntercityDepartureState, late: OverdueDeparture | undefined): GarageAction | null {
  if (late) return late.actions.includes('cancel') ? 'cancel' : late.actions.includes('arrive') ? 'arrive' : null;
  return state === 'arrived' ? 'close' : null;
}
