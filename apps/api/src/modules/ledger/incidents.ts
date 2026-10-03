import type { Clock } from '../../shared/clock.js';
import type { LedgerEventBus } from './events.adapter.js';

/**
 * Incidents the ledger opens (nightly imbalance, hand-over discrepancy) and checks (adjustments
 * must link one, G-85). Incidents belong to the support module; until it exposes an incident
 * port, this implementation announces each one as `incident.opened` on the bus and remembers ids.
 *
 * TODO(support module): bind `LEDGER_INCIDENTS` to the support module's incident service so
 * `exists` sees incidents opened anywhere, not only by the ledger.
 */
export interface LedgerIncidentPort {
  open(input: { kind: string; summary: string; evidence?: Record<string, unknown>; orderId?: string; tripId?: string }): Promise<string>;
  exists(incidentId: string): Promise<boolean>;
}

export class LedgerIncidents implements LedgerIncidentPort {
  private readonly known = new Map<string, { kind: string; summary: string }>();
  private seq = 0;

  constructor(
    private readonly bus: LedgerEventBus,
    private readonly clock: Clock,
  ) {}

  async open(input: { kind: string; summary: string; evidence?: Record<string, unknown>; orderId?: string; tripId?: string }): Promise<string> {
    this.seq += 1;
    const id = `inc_ledger_${this.clock.now().getTime().toString(36)}_${this.seq}`;
    this.known.set(id, { kind: input.kind, summary: input.summary });
    await this.bus.emit(
      undefined,
      {
        actorId: 'system:ledger',
        type: 'incident.opened',
        occurredAt: this.clock.now(),
        ...(input.tripId ? { tripId: input.tripId } : {}),
        payload: { incidentId: id, kind: input.kind, summary: input.summary, evidence: input.evidence ?? {}, ...(input.orderId ? { orderId: input.orderId } : {}) },
        idempotencyKey: `incident:${id}`,
      },
      { name: 'incident', id },
    );
    return id;
  }

  /** Lets support (or a test) declare an incident it opened elsewhere. */
  register(incidentId: string, kind = 'external'): void {
    this.known.set(incidentId, { kind, summary: '' });
  }

  async exists(incidentId: string): Promise<boolean> {
    return this.known.has(incidentId);
  }

  opened(): Array<{ id: string; kind: string; summary: string }> {
    return [...this.known.entries()].map(([id, v]) => ({ id, ...v }));
  }
}
