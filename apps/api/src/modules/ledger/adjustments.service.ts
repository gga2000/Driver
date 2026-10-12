import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DriverError, type MoneyRules, type RoleKind } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { LedgerIncidentPort } from './incidents.js';
import { LedgerService } from './ledger.service.js';
import { postAdjustment } from './postings.js';
import { LEDGER_INCIDENTS, MONEY_RULES } from './tokens.js';

export interface FinanceActor {
  personId: string;
  /** Live roles of the actor (the caller looks them up; a revoked role must not pass). */
  roles: readonly RoleKind[];
}

export interface AdjustmentRequest {
  amountIqd: number;
  fromAccount: string;
  toAccount: string;
  reason: string;
  incidentId: string;
}

export interface Adjustment extends AdjustmentRequest {
  id: string;
  status: 'posted' | 'pending_second_approval';
  requestedBy: string;
  approvedBy: string | null;
  requestedAt: Date;
  postedAt: Date | null;
}

/** Where a request above the second-approver line waits (the Console's persisted second-OK queue). */
export type ParkAdjustment = (adj: Adjustment) => Promise<Adjustment>;

/**
 * Hand-written corrections (edge-case G-85): only finance may post one, with a reason and a linked
 * incident; above 25,000 a second, different finance person must approve before anything posts.
 *
 * The service keeps no pending state: a request above the line is handed to `park` (the caller's
 * persisted queue) and posts only when `approve` is called with it. Posting is idempotent per
 * adjustment id (`adjustment:<id>`).
 */
@Injectable()
export class AdjustmentService {
  private readonly incidentSources: Array<(incidentId: string) => Promise<boolean>> = [];

  constructor(
    private readonly ledger: LedgerService,
    @Inject(LEDGER_INCIDENTS) private readonly incidents: LedgerIncidentPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MONEY_RULES) private readonly rules: MoneyRules,
  ) {}

  /** Other places an incident may live (support tickets): a correction may link any of them. */
  linkIncidents(source: (incidentId: string) => Promise<boolean>): void {
    this.incidentSources.push(source);
  }

  private async incidentKnown(incidentId: string): Promise<boolean> {
    if (await this.incidents.exists(incidentId)) return true;
    for (const source of this.incidentSources) if (await source(incidentId)) return true;
    return false;
  }

  /** Posts at once up to the second-approver line; above it, nothing posts and `park` keeps the request. */
  async request(actor: FinanceActor, input: AdjustmentRequest, park: ParkAdjustment): Promise<Adjustment> {
    if (!actor.roles.includes('finance')) throw new DriverError('forbidden');
    if (input.reason.trim().length < 5 || !input.incidentId || !(await this.incidentKnown(input.incidentId))) throw new DriverError('adjustment_incident_required');
    if (!Number.isInteger(input.amountIqd) || input.amountIqd <= 0 || input.fromAccount === input.toAccount) throw new DriverError('invalid_input');
    const now = this.clock.now();
    const adj: Adjustment = {
      ...input,
      reason: input.reason.trim(),
      id: `adj_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      status: 'pending_second_approval',
      requestedBy: actor.personId,
      approvedBy: null,
      requestedAt: now,
      postedAt: null,
    };
    if (input.amountIqd > this.rules.adjustments.secondApproverAboveIqd) return park(adj);
    return this.post(adj, null);
  }

  /** A second, different finance person lets a parked request post. */
  async approve(actor: FinanceActor, adj: Adjustment, tx?: Tx): Promise<Adjustment> {
    if (!actor.roles.includes('finance')) throw new DriverError('forbidden');
    if (actor.personId === adj.requestedBy) throw new DriverError('adjustment_second_approver');
    return this.post(adj, actor.personId, tx);
  }

  private async post(adj: Adjustment, approvedBy: string | null, tx?: Tx): Promise<Adjustment> {
    const at = this.clock.now();
    await this.ledger.recordAll(postAdjustment({ ...adj, occurredAt: at }), tx);
    return { ...adj, status: 'posted', approvedBy, postedAt: at };
  }
}
