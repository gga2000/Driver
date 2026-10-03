import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
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
  /** Restaurants and grocers: order-taking settings (mirrors orgs.auto_accept / pause_windows / last_heartbeat). */
  merchant?: MerchantSettings;
}

/** Local-time weekly window, e.g. Friday prayer `{dow: 5, start: '11:45', end: '13:15'}`. */
export interface MerchantPauseWindow {
  dow: number;
  start: string;
  end: string;
  reason?: string;
}

export interface MerchantSettings {
  /** Earned by behaviour (domain §2): skips the 90-s acceptance. */
  autoAccept: boolean;
  /** Null = the city's seeded defaults (Friday prayer). */
  pauseWindows: MerchantPauseWindow[] | null;
  /** Last merchant-app heartbeat (edge-case review A.2). */
  lastHeartbeatAt: Date | null;
  defaultPrepMin: number | null;
  commissionPct: number | null;
}

const DEFAULT_MERCHANT_SETTINGS: MerchantSettings = { autoAccept: false, pauseWindows: null, lastHeartbeatAt: null, defaultPrepMin: null, commissionPct: null };

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
  private readonly logger = new Logger(OrgsService.name);
  private readonly inflight = new Set<Promise<void>>();

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

  /** Order-taking settings of a restaurant or grocer (defaults when never set). */
  merchantSettings(orgId: string): MerchantSettings {
    return { ...DEFAULT_MERCHANT_SETTINGS, ...this.get(orgId).merchant };
  }

  setMerchantSettings(orgId: string, patch: Partial<Omit<MerchantSettings, 'lastHeartbeatAt'>>): MerchantSettings {
    const org = this.get(orgId);
    org.merchant = { ...DEFAULT_MERCHANT_SETTINGS, ...org.merchant, ...patch };
    return { ...org.merchant };
  }

  /** Merchant-app presence ping (edge-case review A.2). */
  heartbeat(orgId: string, at: Date = this.clock.now()): void {
    const org = this.get(orgId);
    org.merchant = { ...DEFAULT_MERCHANT_SETTINGS, ...org.merchant, lastHeartbeatAt: at };
  }

  householdsOf(personId: string): Org[] {
    return [...this.orgs.values()].filter((o) => o.type === 'household' && o.members.some((m) => m.personId === personId));
  }

  /**
   * Orgs is still in-memory and synchronous (its Prisma repository is pending), so there is no
   * caller transaction to join: each event commits in a transaction of its own. Callers that need
   * to observe it (tests) await `settled()`.
   */
  private emit(type: string, actorId: string, payload: Record<string, unknown>, orgId: string): void {
    if (!this.events) return;
    const p = this.events
      .emit(undefined, { actorId, type, occurredAt: this.clock.now(), payload }, { name: 'org', id: orgId })
      .then(() => undefined, (err: unknown) => this.logger.error(`${type} not recorded: ${(err as Error).message}`));
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
  }

  /** Resolves when every event emitted so far has been recorded (and, without Redis, delivered). */
  async settled(): Promise<void> {
    await Promise.all([...this.inflight]);
  }
}
