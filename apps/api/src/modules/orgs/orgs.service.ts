import { Inject, Injectable, Optional } from '@nestjs/common';
import { DriverError } from '@driver/contracts';
import { CLOCK, SystemClock, type Clock } from '../../shared/clock.js';
import { EventsService } from '../events/index.js';

export type OrgType = 'restaurant' | 'grocer' | 'fleet' | 'household';
export type OrgMemberRole = 'payer' | 'orderer' | 'member';

export interface OrgMember {
  personId: string;
  role: OrgMemberRole;
  /** Household: orders above this ask the payer for one-tap approval. Null = no limit. */
  spendingLimitIqd: number | null;
}

export interface Org {
  id: string;
  type: OrgType;
  name: string;
  cityId: string;
  members: OrgMember[];
}

export interface PayerApprovalRequest {
  id: string;
  orgId: string;
  orderId: string;
  requestedBy: string;
  payerId: string;
  amountIqd: number;
  state: 'pending' | 'approved' | 'declined';
  createdAt: Date;
}

/**
 * Orgs: restaurants, grocers, fleets and households (domain §12). In-memory in M2 Step 2; the
 * Prisma repository lands with the orders module (Step 4) which is the first real reader.
 */
@Injectable()
export class OrgsService {
  private readonly orgs = new Map<string, Org>();
  private readonly approvals = new Map<string, PayerApprovalRequest>();
  private seq = 0;
  private readonly clock: Clock;

  constructor(
    @Optional() private readonly events?: EventsService,
    @Optional() @Inject(CLOCK) clock?: Clock,
  ) {
    this.clock = clock ?? new SystemClock();
  }

  create(input: { type: OrgType; name: string; cityId: string; ownerId: string }): Org {
    this.seq += 1;
    const ownerRole: OrgMemberRole = input.type === 'household' ? 'payer' : 'member';
    const org: Org = {
      id: `org_${this.seq}`,
      type: input.type,
      name: input.name,
      cityId: input.cityId,
      members: [{ personId: input.ownerId, role: ownerRole, spendingLimitIqd: null }],
    };
    this.orgs.set(org.id, org);
    this.emit('org.created', input.ownerId, { orgId: org.id, type: org.type, cityId: org.cityId }, org.id);
    return org;
  }

  /** A household: the creator is its first payer. */
  createHousehold(input: { name: string; cityId: string; payerId: string }): Org {
    return this.create({ type: 'household', name: input.name, cityId: input.cityId, ownerId: input.payerId });
  }

  addMember(orgId: string, personId: string, opts: { role?: OrgMemberRole; spendingLimitIqd?: number | null; actorId?: string } = {}): Org {
    const org = this.get(orgId);
    const existing = org.members.find((m) => m.personId === personId);
    if (existing) {
      if (opts.role) existing.role = opts.role;
      if (opts.spendingLimitIqd !== undefined) existing.spendingLimitIqd = opts.spendingLimitIqd;
      return org;
    }
    org.members.push({ personId, role: opts.role ?? 'member', spendingLimitIqd: opts.spendingLimitIqd ?? null });
    this.emit('org.member_added', opts.actorId ?? personId, { orgId, personId, role: opts.role ?? 'member', spendingLimitIqd: opts.spendingLimitIqd ?? null }, orgId);
    return org;
  }

  setSpendingLimit(orgId: string, personId: string, spendingLimitIqd: number | null): OrgMember {
    const m = this.member(orgId, personId);
    m.spendingLimitIqd = spendingLimitIqd;
    return m;
  }

  member(orgId: string, personId: string): OrgMember {
    const m = this.get(orgId).members.find((x) => x.personId === personId);
    if (!m) throw new DriverError('not_household_member');
    return m;
  }

  payersOf(orgId: string): OrgMember[] {
    return this.get(orgId).members.filter((m) => m.role === 'payer');
  }

  /** True when `amountIqd` is within the member's limit (payers are never limited). */
  withinLimit(orgId: string, personId: string, amountIqd: number): boolean {
    const m = this.member(orgId, personId);
    if (m.role === 'payer' || m.spendingLimitIqd === null) return true;
    return amountIqd <= m.spendingLimitIqd;
  }

  /** Orders over a member's limit request one-tap payer approval (domain §12). Idempotent per order. */
  requestPayerApproval(input: { orgId: string; orderId: string; requestedBy: string; amountIqd: number }): PayerApprovalRequest {
    const existing = [...this.approvals.values()].find((a) => a.orderId === input.orderId && a.orgId === input.orgId);
    if (existing) return existing;
    this.member(input.orgId, input.requestedBy);
    const payer = this.payersOf(input.orgId)[0];
    if (!payer) throw new DriverError('no_payer');
    this.seq += 1;
    const req: PayerApprovalRequest = {
      id: `pay_${this.seq}`,
      orgId: input.orgId,
      orderId: input.orderId,
      requestedBy: input.requestedBy,
      payerId: payer.personId,
      amountIqd: input.amountIqd,
      state: 'pending',
      createdAt: this.clock.now(),
    };
    this.approvals.set(req.id, req);
    this.emit('org.payer_approval_requested', input.requestedBy, { orgId: input.orgId, orderId: input.orderId, payerId: payer.personId, amountIqd: input.amountIqd, requestId: req.id }, input.orgId);
    return req;
  }

  resolvePayerApproval(requestId: string, payerId: string, decision: 'approved' | 'declined'): PayerApprovalRequest {
    const req = this.approvals.get(requestId);
    if (!req) throw new DriverError('not_found');
    if (req.payerId !== payerId && !this.payersOf(req.orgId).some((p) => p.personId === payerId)) throw new DriverError('forbidden');
    if (req.state !== 'pending') return req;
    req.state = decision;
    this.emit(decision === 'approved' ? 'org.payer_approved' : 'org.payer_declined', payerId, { orgId: req.orgId, orderId: req.orderId, requestId }, req.orgId);
    return req;
  }

  pendingApprovals(orgId: string): PayerApprovalRequest[] {
    return [...this.approvals.values()].filter((a) => a.orgId === orgId && a.state === 'pending');
  }

  get(orgId: string): Org {
    const org = this.orgs.get(orgId);
    if (!org) throw new DriverError('org_not_found');
    return org;
  }

  inCity(cityId: string, type?: OrgType): Org[] {
    return [...this.orgs.values()].filter((o) => o.cityId === cityId && (type === undefined || o.type === type));
  }

  householdsOf(personId: string): Org[] {
    return [...this.orgs.values()].filter((o) => o.type === 'household' && o.members.some((m) => m.personId === personId));
  }

  private emit(type: string, actorId: string, payload: Record<string, unknown>, orgId: string): void {
    this.events?.emit({ actorId, type, occurredAt: this.clock.now(), payload }, { name: 'org', id: orgId });
  }
}
