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
 * What the child row at this stop offers: a big "صعد" at a pickup, a big "نزل" at a drop-off (only
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

/** The run to open on: the first one not finished, else the last. */
export function activeRunIndex(trips: readonly KhatRunTrip[]): number {
  const i = trips.findIndex((t) => !runFinished(t));
  return i === -1 ? Math.max(0, trips.length - 1) : i;
}

/** Progress share for the header bar (delivered of children who travel today). */
export function deliveredShare(trip: Pick<KhatRunTrip, 'childrenTotal' | 'delivered' | 'absent'>): number {
  const travelling = trip.childrenTotal - trip.absent;
  return travelling <= 0 ? 1 : Math.min(1, trip.delivered / travelling);
}
