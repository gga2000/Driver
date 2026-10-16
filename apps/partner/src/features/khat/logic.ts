/**
 * خطوط — pure rules behind the khat run screen (edge-case decisions §5: per-child tap-in/tap-out by
 * name at each stop; the guardian's "arrived" push rides on the school tap-out). Plain Node, tested.
 * A run is a Trip whose stops each carry one child; the screen groups consecutive stops at the same
 * place into one stop card ("استلام · الهاشمي" with the children picked up there).
 */
import type { KhatRunTrip, KhatStopView } from '@driver/contracts';

export type PlaceStatus = 'done' | 'current' | 'upcoming';

export interface KhatPlace {
  key: string;
  type: KhatStopView['type'];
  zoneKey: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  stops: KhatStopView[];
  status: PlaceStatus;
}

/** A child stop needs nothing more from the driver. */
export function stopSettled(s: KhatStopView): boolean {
  return s.absent || s.state === 'completed' || s.state === 'skipped';
}

/** Consecutive stops of the same kind in the same zone become one place, in run order. */
export function groupPlaces(trip: Pick<KhatRunTrip, 'stops'>): KhatPlace[] {
  const sorted = [...trip.stops].sort((a, b) => a.seq - b.seq);
  const places: Omit<KhatPlace, 'status'>[] = [];
  for (const s of sorted) {
    const last = places[places.length - 1];
    if (last && last.type === s.type && last.zoneKey === s.zoneKey) {
      last.stops.push(s);
      if (s.windowEnd && (!last.windowEnd || s.windowEnd > last.windowEnd)) last.windowEnd = s.windowEnd;
      continue;
    }
    places.push({ key: `${s.seq}:${s.type}:${s.zoneKey}`, type: s.type, zoneKey: s.zoneKey, windowStart: s.windowStart, windowEnd: s.windowEnd, stops: [s] });
  }
  let currentGiven = false;
  return places.map((p) => {
    const done = p.stops.every(stopSettled);
    let status: PlaceStatus = 'upcoming';
    if (done) status = 'done';
    else if (!currentGiven) {
      status = 'current';
      currentGiven = true;
    }
    return { ...p, status };
  });
}

export type ChildAction = 'tap_in' | 'tap_out' | 'tapped_in' | 'tapped_out' | 'absent' | 'skipped' | 'not_on_board' | 'none';

/**
 * What the child row at this stop offers: a big "صعود" at a pickup, a big "نزول" at a drop-off (only
 * once the child is on board), or the settled state. Absence wins over everything.
 */
export function childAction(trip: Pick<KhatRunTrip, 'stops'>, stop: KhatStopView): ChildAction {
  if (!stop.child) return 'none';
  if (stop.absent) return 'absent';
  if (stop.type === 'pickup') {
    if (stop.tappedInAt) return 'tapped_in';
    if (stop.state === 'skipped') return 'skipped';
    return 'tap_in';
  }
  if (stop.type === 'dropoff') {
    if (stop.tappedOutAt) return 'tapped_out';
    if (stop.state === 'skipped') return 'skipped';
    const pickup = trip.stops.find((s) => s.type === 'pickup' && s.child?.childRef === stop.child!.childRef);
    if (pickup && !pickup.tappedInAt) return 'not_on_board';
    return 'tap_out';
  }
  return 'none';
}

/** The driver may report a child absent until the child is tapped in (server: stop_state_conflict after). */
export function canReportAbsent(trip: Pick<KhatRunTrip, 'stops'>, childRef: string): boolean {
  const stops = trip.stops.filter((s) => s.child?.childRef === childRef);
  return stops.length > 0 && !stops.some((s) => s.absent || s.tappedInAt !== null);
}

/** Every child stop settled: the run is over for today. */
export function runFinished(trip: Pick<KhatRunTrip, 'stops' | 'state'>): boolean {
  if (trip.state === 'completed') return true;
  const childStops = trip.stops.filter((s) => s.child);
  return childStops.length > 0 && childStops.every(stopSettled);
}

/** When the run starts: its first stop window. */
export function runStart(trip: Pick<KhatRunTrip, 'stops'>): Date | null {
  const ws = trip.stops.map((s) => s.windowStart).filter((d): d is Date => d !== null);
  return ws.length ? new Date(Math.min(...ws.map((d) => d.getTime()))) : null;
}

/**
 * The run to open on: a finished run whose car nobody checked yet (the sweep comes first, even after
 * an app restart), else the first one not finished, else the last.
 */
export function activeRunIndex(trips: readonly KhatRunTrip[]): number {
  const unswept = trips.findIndex((t) => needsSweep(t));
  if (unswept !== -1) return unswept;
  const i = trips.findIndex((t) => !runFinished(t));
  return i === -1 ? Math.max(0, trips.length - 1) : i;
}

/** The header chips (partner S-6): "بالسيارة 2 · وصلوا 0 من 5 · غياب 1". */
export function runChips(trip: Pick<KhatRunTrip, 'childrenTotal' | 'onBoard' | 'delivered' | 'absent'>): { onBoard: number; delivered: number; total: number; absent: number } {
  return { onBoard: trip.onBoard, delivered: trip.delivered, total: Math.max(0, trip.childrenTotal - trip.absent), absent: trip.absent };
}

/**
 * A run is under way from the first tap (or a child on board) until the car is confirmed empty.
 * While any run is under way, substitute offers stay out of sight (audit P-15): he is driving children.
 */
export function runUnderway(trip: Pick<KhatRunTrip, 'stops' | 'state' | 'onBoard' | 'emptyCarCheckedAt'>): boolean {
  if (trip.emptyCarCheckedAt) return false;
  if (trip.onBoard > 0) return true;
  return trip.stops.some((s) => s.tappedInAt !== null || s.tappedOutAt !== null);
}

/** Every child is dropped or absent but nobody has checked the back seats yet: the two-step sweep. */
export function needsSweep(trip: Pick<KhatRunTrip, 'stops' | 'state' | 'emptyCarCheckedAt'>): boolean {
  return runFinished(trip) && !trip.emptyCarCheckedAt;
}

/**
 * Step 1 of the sweep is a forced pause (Ali, 2026-10-06): "باوعت، كمّل" waits `pauseSec` from when
 * the step appeared, so a tap without looking is not possible. Whole seconds left, counting down
 * 3 → 2 → 1 → 0 (0 = the button works). A clock that jumps back never makes the wait longer.
 */
export function lookPauseLeft(shownAt: number, now: number, pauseSec: number): number {
  const elapsed = Math.max(0, now - shownAt);
  return Math.max(0, Math.ceil((pauseSec * 1000 - elapsed) / 1000));
}

/** The next time on the run: the current place's window (the stop he is driving to). */
export function nextStopAt(places: readonly KhatPlace[]): Date | null {
  return places.find((p) => p.status === 'current')?.windowStart ?? null;
}

/** Progress share for the header bar (delivered of children who travel today). */
export function deliveredShare(trip: Pick<KhatRunTrip, 'childrenTotal' | 'delivered' | 'absent'>): number {
  const travelling = trip.childrenTotal - trip.absent;
  return travelling <= 0 ? 1 : Math.min(1, trip.delivered / travelling);
}

export interface NextChild {
  stop: KhatStopView;
  place: KhatPlace;
  /** The other children still waiting at the same place (first names), for «بنفس المكان: …». */
  alsoHere: string[];
}

/**
 * Partner redesign k2: the one child to look for now — the first child at the current place who still
 * needs a tap («بالسيارة» at a pickup, «نزول» at the school). Null when the run is over or the current
 * place has nobody left to tap (e.g. every drop waits on a child not yet on board).
 */
export function nextChild(trip: Pick<KhatRunTrip, 'stops'>, places: readonly KhatPlace[]): NextChild | null {
  const place = places.find((p) => p.status === 'current');
  if (!place) return null;
  const open = place.stops.filter((s) => {
    const a = childAction(trip, s);
    return a === 'tap_in' || a === 'tap_out';
  });
  const stop = open[0];
  if (!stop) return null;
  return { stop, place, alsoHere: open.slice(1).map((s) => s.child!.firstName) };
}

/**
 * Whole minutes from now to a stop's time, rounded up (5:00.1 away is «بعد 6»); 0 once it is due.
 * Its scheduled time, not a drive estimate: the line says «الموعد …».
 */
export function minutesUntil(at: Date | null, now: number): number | null {
  if (!at) return null;
  const ms = at.getTime() - now;
  return ms <= 0 ? 0 : Math.ceil(ms / 60_000);
}
