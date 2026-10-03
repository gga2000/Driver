import { Inject, Injectable } from '@nestjs/common';
import { DriverError, type MoneyRules, type RoleKind } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
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

/**
 * Hand-written corrections (edge-case G-85): only finance may post one, with a reason and a linked
 * incident; above 25,000 a second, different finance person must approve before anything posts.
 *
 * Pending requests live in memory for M2 (no table yet); a restart drops unapproved requests,
 * which is the safe failure (nothing was posted).
 */
@Injectable()
export class AdjustmentService {
  private readonly pending = new Map<string, Adjustment>();
  private seq = 0;

  constructor(
    private readonly ledger: LedgerService,
    @Inject(LEDGER_INCIDENTS) private readonly incidents: LedgerIncidentPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MONEY_RULES) private readonly rules: MoneyRules,
  ) {}

  async request(actor: FinanceActor, input: AdjustmentRequest): Promise<Adjustment> {
    if (!actor.roles.includes('finance')) throw new DriverError('forbidden');
    if (input.reason.trim().length < 5 || !input.incidentId || !(await this.incidents.exists(input.incidentId))) throw new DriverError('adjustment_incident_required');
    if (!Number.isInteger(input.amountIqd) || input.amountIqd <= 0) throw new DriverError('invalid_input');
    this.seq += 1;
    const now = this.clock.now();
    const adj: Adjustment = {
      ...input,
      reason: input.reason.trim(),
      id: `adj_${now.getTime().toString(36)}_${this.seq}`,
      status: 'pending_second_approval',
      requestedBy: actor.personId,
      approvedBy: null,
      requestedAt: now,
      postedAt: null,
    };
    if (input.amountIqd > this.rules.adjustments.secondApproverAboveIqd) {
      this.pending.set(adj.id, adj);
      return { ...adj };
    }
    return this.post(adj, null);
  }

  async approve(actor: FinanceActor, adjustmentId: string): Promise<Adjustment> {
    if (!actor.roles.includes('finance')) throw new DriverError('forbidden');
    const adj = this.pending.get(adjustmentId);
    if (!adj) throw new DriverError('not_found');
    if (actor.personId === adj.requestedBy) throw new DriverError('adjustment_second_approver');
    const posted = await this.post(adj, actor.personId);
    this.pending.delete(adjustmentId);
    return posted;
  }

  pendingApprovals(): Adjustment[] {
    return [...this.pending.values()].map((a) => ({ ...a }));
  }

  private async post(adj: Adjustment, approvedBy: string | null): Promise<Adjustment> {
    const at = this.clock.now();
    await this.ledger.recordAll(postAdjustment({ ...adj, occurredAt: at }));
    return { ...adj, status: 'posted', approvedBy, postedAt: at };
  }
}
