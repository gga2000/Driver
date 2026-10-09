import { Inject, Injectable } from '@nestjs/common';
import type { CapRole, CapTier, MoneyRules } from '@driver/contracts';
import type { Clock } from '../../shared/clock.js';
import { Accounts } from './accounts.js';
import { LedgerService } from './ledger.service.js';
import { MONEY_RULES } from './tokens.js';

/**
 * Cash caps (money §4, decisions §3, edge-case G-80). A driver's exposure is the cash he holds
 * that is not his — cash not yet returned to merchants plus fees and commission owed — net of what
 * the platform owes him: owed = max(0, −(cash + earnings)). Prepaid jobs never add to it.
 */

export interface DriverPosition {
  /** `driver:` balance: earnings the platform owes him. */
  earningsIqd: number;
  /** `cash:` balance: negative while he holds others' cash. */
  cashIqd: number;
}

export interface JobExposure {
  /** Cash the job will put in his hands that is not his. */
  valueIqd: number;
  prepaid: boolean;
}

export interface CapStatus {
  driverId: string;
  role: CapRole;
  tier: CapTier;
  owedIqd: number;
  capIqd: number;
  capRemainingIqd: number;
  overCap: boolean;
  /** G-86: what the platform should pay out to him now (0 unless it owes him beyond the threshold). */
  payoutDueIqd: number;
  earningsIqd: number;
  cashIqd: number;
}

export function owedOf(p: DriverPosition): number {
  return Math.max(0, -(p.cashIqd + p.earningsIqd));
}

export function capFor(role: CapRole, tier: CapTier, rules: MoneyRules): number {
  return rules.caps.byRole[role][tier];
}

/** Over cap: finish the current job, no new offers (money §4). Exactly at the cap counts as over. */
export function isOverCapAmount(owedIqd: number, capIqd: number): boolean {
  return owedIqd >= capIqd;
}

/**
 * May this driver be offered this job? Over cap → no. Prepaid → yes (no cash). Otherwise the job
 * must fit under the cap, unless it is a single job worth ≤ 50 % of the cap, which may exceed it.
 */
export function canOfferJob(owedIqd: number, capIqd: number, job: JobExposure | undefined, rules: MoneyRules): boolean {
  if (isOverCapAmount(owedIqd, capIqd)) return false;
  if (!job || job.prepaid) return true;
  if (owedIqd + job.valueIqd <= capIqd) return true;
  return job.valueIqd <= capIqd * rules.caps.singleJobShareOfCap;
}

/** G-86: pay out when the platform owes the driver more than the threshold, or any positive amount on the weekly run. */
export function payoutDue(p: DriverPosition, rules: MoneyRules, weekly = false): number {
  const net = p.cashIqd + p.earningsIqd;
  if (net <= 0) return 0;
  return weekly || net > rules.driverPayoutAboveIqd ? net : 0;
}

/** Decisions §4: the first three cash orders of a new account are capped at 25,000 and need the arriving call. */
export function newCustomerCashDecision(priorCashOrders: number, orderTotalIqd: number, rules: MoneyRules): { allowed: boolean; requiresArrivingCall: boolean } {
  const isNew = priorCashOrders < rules.newCustomerCash.firstOrders;
  return { allowed: !isNew || orderTotalIqd <= rules.newCustomerCash.maxOrderIqd, requiresArrivingCall: isNew };
}

/** Where a driver's role and tier come from (identity and scoring own them; `IdentityScoringCapProfiles` in production). */
export interface DriverCapProfileResolver {
  profile(driverId: string): Promise<{ role: CapRole; tier: CapTier }>;
}

export const CAP_PROFILE_RESOLVER = Symbol('CAP_PROFILE_RESOLVER');

/** In-memory profiles with a default; the simulator and tests set them explicitly. */
export class StaticCapProfiles implements DriverCapProfileResolver {
  private readonly profiles = new Map<string, { role: CapRole; tier: CapTier }>();

  constructor(private readonly fallback: { role: CapRole; tier: CapTier } = { role: 'courier', tier: 'bronze' }) {}

  set(driverId: string, profile: { role: CapRole; tier: CapTier }): void {
    this.profiles.set(driverId, profile);
  }

  async profile(driverId: string): Promise<{ role: CapRole; tier: CapTier }> {
    return this.profiles.get(driverId) ?? this.fallback;
  }
}

/** Identity's role port, as the ledger needs it (structural: `RoleReader` from `modules/identity`). */
export interface CapRoleSource {
  activeRoles(personId: string): Promise<readonly string[]>;
}

/** Scoring's cap tier, as the ledger needs it (structural: `ScoringService.capTier`). Null = no scorecard yet. */
export interface CapTierSource {
  capTier(driverId: string, now: Date): Promise<CapTier | null>;
}

/** Driving roles → the cap role they are capped as (shoppers carry cash like couriers). */
const CAP_ROLE_OF: Readonly<Record<string, CapRole>> = {
  courier: 'courier',
  shopper: 'courier',
  driver: 'driver',
  khat_driver: 'khat_driver',
  intercity_driver: 'intercity_driver',
};
const CAP_ROLE_PREFERENCE: readonly CapRole[] = ['intercity_driver', 'driver', 'khat_driver', 'courier'];

/**
 * G-80 caps by role for a person holding several driving roles: the one with the highest cap (at
 * the bronze row) wins, so an intercity driver who also delivers keeps his intercity cap. No
 * driving role at all (shouldn't be offered anything) → courier, the smallest.
 */
export function capRoleOf(roles: readonly string[], rules: MoneyRules): CapRole {
  // Preference order breaks ties: a driver who also delivers is capped as a driver.
  const held = CAP_ROLE_PREFERENCE.filter((r) => roles.some((k) => CAP_ROLE_OF[k] === r));
  if (held.length === 0) return 'courier';
  return held.reduce((best, r) => (rules.caps.byRole[r].bronze > rules.caps.byRole[best].bronze ? r : best));
}

/** Production resolver: role from identity, tier from scoring (bronze while there is no scorecard). */
export class IdentityScoringCapProfiles implements DriverCapProfileResolver {
  constructor(
    private readonly roles: CapRoleSource,
    private readonly tiers: CapTierSource,
    private readonly clock: Clock,
    private readonly rules: MoneyRules,
  ) {}

  async profile(driverId: string): Promise<{ role: CapRole; tier: CapTier }> {
    const [roles, tier] = await Promise.all([this.roles.activeRoles(driverId), this.tiers.capTier(driverId, this.clock.now())]);
    return { role: capRoleOf(roles, this.rules), tier: tier ?? 'bronze' };
  }
}

/** What dispatch asks before offering (plan Step 5: over-cap drivers excluded after the current job). */
export interface CapsPort {
  isOverCap(driverId: string): Promise<boolean>;
  canOffer(driverId: string, job?: JobExposure): Promise<boolean>;
  status(driverId: string): Promise<CapStatus>;
}

/** What orders asks before accepting a cash order from a new account. */
export interface CashRiskPort {
  newCustomerCash(customerId: string, orderTotalIqd: number): Promise<{ allowed: boolean; requiresArrivingCall: boolean; priorCashOrders: number }>;
}

/**
 * Speed x2: how long the partner app's own reads (heartbeat, status) keep a driver's cap role and tier,
 * so his cash limit is worked out once (the tier reads his whole event history) instead of on every
 * beat. His cash and earnings are still read every time. Dispatch's over-cap check never uses it.
 */
export const KEPT_LIMIT_MS = 5 * 60_000;

@Injectable()
export class CapsService implements CapsPort, CashRiskPort {
  private readonly keptProfiles = new Map<string, { at: number; profile: Promise<{ role: CapRole; tier: CapTier }> }>();

  constructor(
    private readonly ledger: LedgerService,
    @Inject(MONEY_RULES) private readonly rules: MoneyRules,
    @Inject(CAP_PROFILE_RESOLVER) private readonly profiles: DriverCapProfileResolver,
  ) {}

  async position(driverId: string): Promise<DriverPosition> {
    const [earnings, cash] = await Promise.all([this.ledger.balance(Accounts.driver(driverId)), this.ledger.balance(Accounts.cash(driverId))]);
    return { earningsIqd: earnings.amount, cashIqd: cash.amount };
  }

  /**
   * `keptLimit`: the role and tier from the last `KEPT_LIMIT_MS` (speed x2; the partner app's own
   * reads only). Without it both are read now, as dispatch and the money desk need.
   */
  async status(driverId: string, opts: { weekly?: boolean; keptLimit?: boolean } = {}): Promise<CapStatus> {
    const [{ role, tier }, pos] = await Promise.all([opts.keptLimit ? this.keptProfile(driverId) : this.profiles.profile(driverId), this.position(driverId)]);
    const capIqd = capFor(role, tier, this.rules);
    const owedIqd = owedOf(pos);
    return {
      driverId,
      role,
      tier,
      owedIqd,
      capIqd,
      capRemainingIqd: Math.max(0, capIqd - owedIqd),
      overCap: isOverCapAmount(owedIqd, capIqd),
      payoutDueIqd: payoutDue(pos, this.rules, opts.weekly),
      earningsIqd: pos.earningsIqd,
      cashIqd: pos.cashIqd,
    };
  }

  private keptProfile(driverId: string): Promise<{ role: CapRole; tier: CapTier }> {
    const now = Date.now();
    const kept = this.keptProfiles.get(driverId);
    if (kept && now - kept.at < KEPT_LIMIT_MS) return kept.profile;
    if (this.keptProfiles.size > 5_000) for (const [id, k] of this.keptProfiles) if (now - k.at >= KEPT_LIMIT_MS) this.keptProfiles.delete(id);
    const profile = this.profiles.profile(driverId);
    const entry = { at: now, profile };
    this.keptProfiles.set(driverId, entry);
    profile.catch(() => {
      if (this.keptProfiles.get(driverId) === entry) this.keptProfiles.delete(driverId);
    });
    return profile;
  }

  async isOverCap(driverId: string): Promise<boolean> {
    return (await this.status(driverId)).overCap;
  }

  async canOffer(driverId: string, job?: JobExposure): Promise<boolean> {
    const s = await this.status(driverId);
    return canOfferJob(s.owedIqd, s.capIqd, job, this.rules);
  }

  async newCustomerCash(customerId: string, orderTotalIqd: number) {
    const prior = (await this.ledger.cashOrders(customerId)).length;
    return { ...newCustomerCashDecision(prior, orderTotalIqd, this.rules), priorCashOrders: prior };
  }
}
