import { encodeDomainEvent, type MoneyRules } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { idOf } from './accounts.js';
import { capFor, isOverCapAmount, owedOf, type DriverCapProfileResolver, type DriverPosition } from './caps.js';
import type { LedgerEventBus } from './events.adapter.js';
import type { NewLedgerEvent } from './repository.js';

/** The single launch city: money rules (and so caps) are Aziziyah's until config serves them per city. */
export const CAP_WATCH_CITY = 'aziziyah';

/**
 * Cash-cap crossings for the Console's "Today" list. `LedgerService.recordAll` hands it the lines it
 * is about to write, with each touched driver's position before them, in the posting's transaction.
 * A driver whose exposure moves from under his cap to over it (in practice a cash collection) gets
 * `courier.cash_over_cap`; from over to under (a hand-in, a settlement) `courier.cash_under_cap`.
 * Nothing is emitted for a posting that leaves him on the same side, and nothing is posted or
 * changed: it only reads amounts and caps.
 */
export class CashCapWatch {
  constructor(
    private readonly profiles: DriverCapProfileResolver,
    private readonly rules: MoneyRules,
    private readonly bus: Pick<LedgerEventBus, 'emit'>,
    private readonly cityId: string = CAP_WATCH_CITY,
  ) {}

  /** Drivers whose cap exposure these lines can move (their `cash:` or `driver:` account is on a line). */
  driversIn(rows: readonly NewLedgerEvent[]): string[] {
    const ids = new Set<string>();
    for (const r of rows) {
      for (const a of [r.fromAccount, r.toAccount]) {
        const id = idOf(a, 'cash') ?? idOf(a, 'driver');
        if (id) ids.add(id);
      }
    }
    return [...ids];
  }

  /** Emits a crossing event per driver whose side of the cap changes from `before` to after `rows`. */
  async afterPosting(rows: readonly NewLedgerEvent[], before: ReadonlyMap<string, DriverPosition>, key: string, tx: Tx | undefined): Promise<void> {
    if (rows.length === 0) return;
    const at = rows.reduce((latest, r) => (r.occurredAt.getTime() > latest.getTime() ? r.occurredAt : latest), rows[0]!.occurredAt);
    for (const [driverId, pos] of before) {
      const after = applyLines(driverId, pos, rows);
      const owedBefore = owedOf(pos);
      const owedAfter = owedOf(after);
      if (owedBefore === owedAfter) continue;
      const { role, tier } = await this.profiles.profile(driverId);
      const capIqd = capFor(role, tier, this.rules);
      const wasOver = isOverCapAmount(owedBefore, capIqd);
      const isOver = isOverCapAmount(owedAfter, capIqd);
      if (wasOver === isOver) continue;
      const type = isOver ? 'courier.cash_over_cap' : 'courier.cash_under_cap';
      await this.bus.emit(
        tx,
        {
          type,
          actorId: 'system',
          occurredAt: at,
          idempotencyKey: `${type}:${driverId}:${key}`,
          payload: encodeDomainEvent(type, { courierId: driverId, cashIqd: owedAfter, capIqd, cityId: this.cityId }),
        },
        { name: 'driver', id: driverId },
      );
    }
  }
}

/** The driver's position after `rows` (inflows minus outflows on his `cash:` and `driver:` accounts). */
export function applyLines(driverId: string, pos: DriverPosition, rows: readonly NewLedgerEvent[]): DriverPosition {
  let { cashIqd, earningsIqd } = pos;
  for (const r of rows) {
    if (idOf(r.toAccount, 'cash') === driverId) cashIqd += r.amount;
    if (idOf(r.fromAccount, 'cash') === driverId) cashIqd -= r.amount;
    if (idOf(r.toAccount, 'driver') === driverId) earningsIqd += r.amount;
    if (idOf(r.fromAccount, 'driver') === driverId) earningsIqd -= r.amount;
  }
  return { cashIqd, earningsIqd };
}
