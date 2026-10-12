import { Inject, Injectable } from '@nestjs/common';
import {
  AZIZIYAH_MONEY_RULES,
  CommissionTier,
  DriverError,
  MerchantCommissionTier,
  STARTER_COMMISSION,
  type Actor,
  type CommissionDueRow,
  type MerchantCommissionView,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { AuditLogService } from '../controls/index.js';
import { ORDERS_RULES } from '../orders/index.js';
import { OrgsService, type Org } from '../orgs/index.js';

/** The audit row a tier change writes (`console_audit_log`); also how the store page finds the last one. */
export const COMMISSION_TIER_AUDIT = { action: 'store.commission_tier_set', subjectKind: 'store' } as const;

const DAY_MS = 86_400_000;
const TIER_AR: Record<CommissionTier, string> = { starter: 'البداية', base: 'الأساسية', featured: 'المميّزة', marketing: 'التسويق', pickup: 'الاستلام', home: 'أكل بيت' };

/** A tier's rate in percent, from the city's money rules (the ledger posts by the same rules). */
export function tierRatePct(tier: CommissionTier): number {
  return Math.round(AZIZIYAH_MONEY_RULES.commission[tier] * 10_000) / 100;
}

/**
 * The starter period of a restaurant on `starter` (Ali, 2026-10-11): counted from the day it was added
 * (its onboarding, `orgs.created_at`), with whole days since and whether the 7-week reminder is due.
 * Null for any other tier. Nothing here changes the tier: a person picks the next one.
 */
export function starterPeriod(org: Pick<Org, 'createdAt'>, tier: CommissionTier, now: Date): { since: Date; days: number; due: boolean } | null {
  if (tier !== 'starter') return null;
  const days = Math.max(0, Math.floor((now.getTime() - org.createdAt.getTime()) / DAY_MS));
  return { since: org.createdAt, days, due: days >= STARTER_COMMISSION.reviewAfterDays };
}

/**
 * Console › a restaurant's commission tier (GAP-06): finance and admins read it and put the store on
 * another tier; every change is a Console audit row under the editor's name. The finance desk lists the
 * starter restaurants whose two months are nearly up. `featured` is a rate only: list order never reads
 * it. The role gate is the router's (`COMMISSION_TIER_ROLES`).
 */
@Injectable()
export class CommissionTierService {
  constructor(
    private readonly orgs: OrgsService,
    private readonly audits: AuditLogService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly uow: UnitOfWork,
  ) {}

  async view(merchantOrgId: string): Promise<MerchantCommissionView> {
    const org = await this.merchantOrg(merchantOrgId);
    const onFile = org.merchant?.commissionTier ?? null;
    const tier = onFile ?? ORDERS_RULES.defaultCommissionTier;
    const starter = starterPeriod(org, tier, this.clock.now());
    const last = (await this.audits.list({ subjectKind: COMMISSION_TIER_AUDIT.subjectKind, subjectId: org.id, limit: 20 })).find((a) => a.action === COMMISSION_TIER_AUDIT.action);
    const tierOf = (v: unknown) => (CommissionTier.safeParse(v).success ? (v as CommissionTier) : null);
    const to = last ? tierOf(last.detail['to']) : null;
    return {
      merchantOrgId: org.id,
      name: org.name,
      tier,
      pct: tierRatePct(tier),
      onFile: onFile !== null,
      starterSince: starter?.since ?? null,
      starterDays: starter?.days ?? null,
      reviewDue: starter?.due ?? false,
      lastChange: last && to ? { at: last.at, byName: last.actorName, from: tierOf(last.detail['from']), to } : null,
      options: MerchantCommissionTier.options.map((t) => ({ tier: t, pct: tierRatePct(t) })),
    };
  }

  async set(actor: Actor, input: { merchantOrgId: string; tier: MerchantCommissionTier }): Promise<MerchantCommissionView> {
    const org = await this.merchantOrg(input.merchantOrgId);
    // Nobody sets the rate of a shop he belongs to: a colleague does.
    if (org.members.some((m) => m.personId === actor.personId)) throw new DriverError('staff_own_account');
    const from = org.merchant?.commissionTier ?? null;
    if (from !== input.tier) {
      // The rate and its audit row commit together: a failed audit write leaves the rate as it was.
      await this.uow.run(async (tx) => {
        await this.orgs.setMerchantSettings(org.id, { commissionTier: input.tier });
        await this.audits.record(
          {
            cityId: org.cityId,
            actorId: actor.personId,
            action: COMMISSION_TIER_AUDIT.action,
            subjectKind: COMMISSION_TIER_AUDIT.subjectKind,
            subjectId: org.id,
            summaryAr: `غيّر عمولة ${org.name} لـ${TIER_AR[input.tier]} (${tierRatePct(input.tier)}%)`,
            detail: { from, to: input.tier, fromPct: tierRatePct(from ?? ORDERS_RULES.defaultCommissionTier), toPct: tierRatePct(input.tier) },
          },
          tx,
        );
      });
    }
    return this.view(org.id);
  }

  /** Starter restaurants of the city past 7 weeks, longest first (the finance desk reminder). */
  async due(cityId: string): Promise<CommissionDueRow[]> {
    const now = this.clock.now();
    const rows: CommissionDueRow[] = [];
    for (const org of await this.orgs.inCity(cityId)) {
      if (org.type !== 'restaurant' && org.type !== 'grocer') continue;
      const p = starterPeriod(org, org.merchant?.commissionTier ?? ORDERS_RULES.defaultCommissionTier, now);
      if (p?.due) rows.push({ merchantOrgId: org.id, name: org.name, starterSince: p.since, days: p.days });
    }
    return rows.sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, 'ar'));
  }

  private async merchantOrg(merchantOrgId: string): Promise<Org> {
    const org = await this.orgs.find(merchantOrgId);
    if (!org || (org.type !== 'restaurant' && org.type !== 'grocer')) throw new DriverError('org_not_found');
    return org;
  }
}
