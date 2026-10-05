import type { BoardOrder } from '@driver/contracts';
import { minutesBetween } from '@/lib/time';

/**
 * S-M4 · the courier at the pass (UI/UX audit merchant-and-console §8), free of React Native so it is
 * unit-tested: when the ready card turns into "حيدر وصل · سلّمه #7046", when it turns amber, and the
 * order the ready column reads in.
 */

/** After this long at the counter the card turns amber: "حيدر ينتظر من 4 دقايق". */
export const PASS_WAIT_WARN_MIN = 3;

export type PassState =
  | {
      kind: 'at_pass';
      tone: 'success' | 'warning';
      /** Whole minutes he has waited at the counter. */
      waitedMin: number;
      /** His first name, or null ("الدليفري"). */
      name: string | null;
      plate: string | null;
    }
  | { kind: 'handed'; at: Date; name: string | null };

type PassFields = Pick<BoardOrder, 'column' | 'courier' | 'handedOverAt'>;

/** The pass card for a ready order whose courier is at the counter; null for every other card. */
export function passState(o: PassFields, now: number): PassState | null {
  if (o.column !== 'ready' || o.courier.state !== 'arrived') return null;
  const name = o.courier.firstName?.trim() || null;
  if (o.handedOverAt) return { kind: 'handed', at: o.handedOverAt, name };
  const waitedMin = o.courier.arrivedAt ? minutesBetween(o.courier.arrivedAt, now) : 0;
  return { kind: 'at_pass', tone: waitedMin >= PASS_WAIT_WARN_MIN ? 'warning' : 'success', waitedMin, name, plate: o.courier.plate ?? null };
}

/** Orders whose courier is waiting at the counter and not yet handed the bag, longest wait first. */
export function waitingAtPass<T extends PassFields & Pick<BoardOrder, 'id'>>(orders: readonly T[], now: number): T[] {
  return orders
    .filter((o) => passState(o, now)?.kind === 'at_pass')
    .sort((a, b) => (a.courier.arrivedAt?.getTime() ?? now) - (b.courier.arrivedAt?.getTime() ?? now) || a.id.localeCompare(b.id));
}

/**
 * The ready column in the order the counter works: couriers waiting first (longest first), then the
 * ones already handed over, then the rest as the server sorted them (by ready time).
 */
export function passFirst<T extends PassFields & Pick<BoardOrder, 'id'>>(ready: readonly T[], now: number): T[] {
  const rank = (o: T) => {
    const p = passState(o, now);
    return p?.kind === 'at_pass' ? 0 : p?.kind === 'handed' ? 1 : 2;
  };
  const waiting = waitingAtPass(ready, now);
  const pos = new Map(waiting.map((o, i) => [o.id, i]));
  return ready
    .map((o, i) => ({ o, i }))
    .sort((a, b) => rank(a.o) - rank(b.o) || (pos.get(a.o.id) ?? 0) - (pos.get(b.o.id) ?? 0) || a.i - b.i)
    .map((x) => x.o);
}
