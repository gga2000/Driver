import { Inject, Injectable } from '@nestjs/common';
import type { CapRole, CapTier, MoneyRules } from '@driver/contracts';
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

/** Where a driver's role and tier come from. Identity/scoring own them; until they expose a port the default is courier/bronze. */
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

@Injectable()
export class CapsService implements CapsPort, CashRiskPort {
  constructor(
    private readonly ledger: LedgerService,
    @Inject(MONEY_RULES) private readonly rules: MoneyRules,
    @Inject(CAP_PROFILE_RESOLVER) private readonly profiles: DriverCapProfileResolver,
  ) {}

  async position(driverId: string): Promise<DriverPosition> {
    const [earnings, cash] = await Promise.all([this.ledger.balance(Accounts.driver(driverId)), this.ledger.balance(Accounts.cash(driverId))]);
    return { earningsIqd: earnings.amount, cashIqd: cash.amount };
  }

  async status(driverId: string, opts: { weekly?: boolean } = {}): Promise<CapStatus> {
    const [{ role, tier }, pos] = await Promise.all([this.profiles.profile(driverId), this.position(driverId)]);
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
