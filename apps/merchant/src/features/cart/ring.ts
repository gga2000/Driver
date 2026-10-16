/**
 * A new walk-over ticket rings the cart owner (Ali 2026-10-11): he is at a hot grill, eyes off the
 * phone. Unlike a delivery order there is no answer window, so it never escalates into the board's
 * alarm: a chime when the ticket comes in, once more after 30 s and once after 60 s while nobody has
 * touched it («جاهزة» or «ما أگدر هسه»), then quiet. Tickets already there when the screen opens don't
 * ring. Free of React and sound so the timing can be tested.
 */

/** When each chime of a fresh ticket plays, from the moment it came in. */
export const WALKUP_RINGS_MS = [0, 30_000, 60_000] as const;
/** How long a ticket wears «جديدة». */
export const FRESH_MS = 90_000;

interface Entry {
  at: number;
  rung: number;
  /** Already there when the screen opened: never rings, never «جديدة». */
  old: boolean;
}

export interface RingState {
  /** Tickets this screen has seen: when they came in and how many chimes played. */
  seen: Map<string, Entry>;
  started: boolean;
}

export const emptyRing = (): RingState => ({ seen: new Map(), started: false });

/**
 * One step: `waiting` are the tickets not yet answered (state `placed`). Returns the next state and
 * whether to chime now. The first step only notes what is already there.
 */
export function ringStep(prev: RingState, waiting: readonly string[], now: number): { state: RingState; chime: boolean } {
  const seen = new Map<string, Entry>();
  let chime = false;
  for (const id of waiting) {
    const was = prev.seen.get(id);
    const entry = was ? { ...was } : prev.started ? { at: now, rung: 0, old: false } : { at: now, rung: WALKUP_RINGS_MS.length, old: true };
    const due = WALKUP_RINGS_MS[entry.rung];
    if (due !== undefined && now - entry.at >= due) {
      chime = true;
      // One chime per step even when several are due: never a burst.
      while (WALKUP_RINGS_MS[entry.rung] !== undefined && now - entry.at >= WALKUP_RINGS_MS[entry.rung]!) entry.rung += 1;
    }
    seen.set(id, entry);
  }
  return { state: { seen, started: true }, chime };
}

/** Tickets that came in while the screen was open, in the last 90 s: they wear «جديدة». */
export function freshIds(state: RingState, now: number): Set<string> {
  const out = new Set<string>();
  for (const [id, e] of state.seen) if (!e.old && now - e.at < FRESH_MS) out.add(id);
  return out;
}
