import type { DealSchedule, DealType } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import { onRollback, type Tx } from '../../shared/db/unit-of-work.js';

export interface DealProjection {
  ordersPerWeek: number;
  costPerOrderIqd: number;
  weeklyCostIqd: number;
  totalCostIqd: number;
  basisOrders: number;
}

/** A merchant-funded self-serve deal: a `promotions` row with funder = merchant. */
export interface DealRecord {
  id: string;
  cityId: string;
  merchantOrgId: string;
  ownerId: string;
  nameAr: string;
  type: DealType;
  value: number;
  itemIds: string[];
  schedule: DealSchedule;
  minOrderIqd: number;
  budgetCapIqd: number | null;
  spentIqd: number;
  projection: DealProjection;
  proposalState: 'pending_approval' | 'approved' | 'rejected';
  /** The merchant's on/off switch. */
  active: boolean;
  approvedAt: Date | null;
  createdAt: Date;
}

export interface PromotionsRepository {
  createDeal(input: Omit<DealRecord, 'id'>, tx?: Tx): Promise<DealRecord>;
  deal(id: string, tx?: Tx): Promise<DealRecord | null>;
  dealsOf(merchantOrgId: string, tx?: Tx): Promise<DealRecord[]>;
  updateDeal(id: string, patch: Partial<Pick<DealRecord, 'active' | 'proposalState' | 'approvedAt'>>, tx?: Tx): Promise<DealRecord>;
  /**
   * Adds `amountIqd` to the deal's spend counter only if it stays within the budget cap — one atomic
   * check-and-increment (no overspend under concurrent orders). False when the cap would be passed.
   */
  reserveSpend(id: string, amountIqd: number, tx?: Tx): Promise<boolean>;
  /** Gives spend back (the order was cancelled or rejected before the deal cost anything); never below 0. */
  releaseSpend(id: string, amountIqd: number, tx?: Tx): Promise<void>;
}

export const PROMOTIONS_REPOSITORY = Symbol('PROMOTIONS_REPOSITORY');

export class InMemoryPromotionsRepository implements PromotionsRepository {
  readonly rows = new Map<string, DealRecord>();
  private seq = 0;

  async createDeal(input: Omit<DealRecord, 'id'>): Promise<DealRecord> {
    this.seq += 1;
    const row = structuredClone({ id: `deal_${this.seq}`, ...input });
    this.rows.set(row.id, row);
    return structuredClone(row);
  }

  async deal(id: string): Promise<DealRecord | null> {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : null;
  }

  async dealsOf(merchantOrgId: string): Promise<DealRecord[]> {
    return [...this.rows.values()].filter((r) => r.merchantOrgId === merchantOrgId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)).map((r) => structuredClone(r));
  }

  async updateDeal(id: string, patch: Partial<Pick<DealRecord, 'active' | 'proposalState' | 'approvedAt'>>): Promise<DealRecord> {
    const r = this.rows.get(id);
    if (!r) throw new Error(`deal ${id} not found`);
    Object.assign(r, patch);
    return structuredClone(r);
  }

  /** Check and increment run without an await in between, so concurrent placements cannot both pass the cap. */
  async reserveSpend(id: string, amountIqd: number, tx?: Tx): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r) return false;
    if (r.budgetCapIqd !== null && r.spentIqd + amountIqd > r.budgetCapIqd) return false;
    r.spentIqd += amountIqd;
    // No database to roll back: undo by hand if the order's unit of work fails after this.
    onRollback(tx, () => {
      r.spentIqd = Math.max(0, r.spentIqd - amountIqd);
    });
    return true;
  }

  async releaseSpend(id: string, amountIqd: number, tx?: Tx): Promise<void> {
    const r = this.rows.get(id);
    if (!r) return;
    const before = r.spentIqd;
    r.spentIqd = Math.max(0, r.spentIqd - amountIqd);
    onRollback(tx, () => {
      r.spentIqd = before;
    });
  }
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

type PromotionRow = {
  id: string;
  cityId: string | null;
  merchantOrgId: string | null;
  ownerId: string;
  nameAr: string;
  effect: unknown;
  scope: unknown;
  limits: unknown;
  budgetCapIqd: number | null;
  spentIqd: number;
  startsAt: Date;
  endsAt: Date;
  active: boolean;
  approvedAt: Date | null;
  proposalState: string | null;
  createdAt: Date;
};

function dealFromRow(r: PromotionRow): DealRecord {
  const effect = obj(r.effect);
  const scope = obj(r.scope);
  const limits = obj(r.limits);
  const schedule = obj(scope['schedule']);
  const projection = obj(effect['projection']) as Partial<DealProjection>;
  return {
    id: r.id,
    cityId: r.cityId ?? '',
    merchantOrgId: r.merchantOrgId ?? '',
    ownerId: r.ownerId,
    nameAr: r.nameAr,
    type: String(effect['kind']) as DealType,
    value: Number(effect['value'] ?? 0),
    itemIds: Array.isArray(scope['items']) ? (scope['items'] as string[]) : [],
    schedule: {
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      days: Array.isArray(schedule['days']) ? (schedule['days'] as number[]) : [],
      ...(schedule['hours'] ? { hours: schedule['hours'] as { start: string; end: string } } : {}),
    },
    minOrderIqd: Number(limits['minOrderIqd'] ?? 0),
    budgetCapIqd: r.budgetCapIqd,
    spentIqd: r.spentIqd,
    projection: {
      ordersPerWeek: projection.ordersPerWeek ?? 0,
      costPerOrderIqd: projection.costPerOrderIqd ?? 0,
      weeklyCostIqd: projection.weeklyCostIqd ?? 0,
      totalCostIqd: projection.totalCostIqd ?? 0,
      basisOrders: projection.basisOrders ?? 0,
    },
    proposalState: r.proposalState === 'approved' || r.proposalState === 'rejected' ? r.proposalState : 'pending_approval',
    active: r.active,
    approvedAt: r.approvedAt,
    createdAt: r.createdAt,
  };
}

/**
 * Merchant deals in `promotions` (funder = merchant): effect {kind, value, projection}, scope
 * {merchants, items, schedule{days, hours}}, limits {minOrderIqd, stacking: false}. `merchant_org_id`
 * and `city_id` reference `orgs` / `cities`, so the merchant must be a database org.
 */
export class PrismaPromotionsRepository implements PromotionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async createDeal(input: Omit<DealRecord, 'id'>, tx?: Tx): Promise<DealRecord> {
    const row = await this.db(tx).promotion.create({
      data: {
        cityId: input.cityId || null,
        nameAr: input.nameAr,
        funder: 'merchant',
        merchantOrgId: input.merchantOrgId,
        ownerId: input.ownerId,
        effect: { kind: input.type, value: input.value, projection: { ...input.projection } },
        scope: { merchants: [input.merchantOrgId], items: input.itemIds, schedule: { days: input.schedule.days, ...(input.schedule.hours ? { hours: input.schedule.hours } : {}) } },
        audience: { kind: 'all' },
        limits: { minOrderIqd: input.minOrderIqd, stacking: false },
        budgetCapIqd: input.budgetCapIqd,
        spentIqd: input.spentIqd,
        autoApply: true,
        approvedAt: input.approvedAt,
        startsAt: input.schedule.startsAt,
        endsAt: input.schedule.endsAt,
        active: input.active,
        proposalState: input.proposalState,
        projectedCostIqd: input.projection.totalCostIqd,
        createdAt: input.createdAt,
      },
    });
    return dealFromRow(row);
  }

  async deal(id: string, tx?: Tx): Promise<DealRecord | null> {
    const row = await this.db(tx).promotion.findUnique({ where: { id } });
    return row && row.funder === 'merchant' ? dealFromRow(row) : null;
  }

  async dealsOf(merchantOrgId: string, tx?: Tx): Promise<DealRecord[]> {
    const rows = await this.db(tx).promotion.findMany({ where: { merchantOrgId, funder: 'merchant' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return rows.map(dealFromRow);
  }

  async updateDeal(id: string, patch: Partial<Pick<DealRecord, 'active' | 'proposalState' | 'approvedAt'>>, tx?: Tx): Promise<DealRecord> {
    return dealFromRow(await this.db(tx).promotion.update({ where: { id }, data: patch }));
  }

  /**
   * One conditional UPDATE: Postgres takes the row lock and re-checks the WHERE after a concurrent
   * writer commits (READ COMMITTED), so two orders can never both spend the last of the budget.
   */
  async reserveSpend(id: string, amountIqd: number, tx?: Tx): Promise<boolean> {
    const n = await this.db(tx).$executeRaw`
      UPDATE "public"."promotions" SET "spent_iqd" = "spent_iqd" + ${amountIqd}, "updated_at" = NOW()
      WHERE "id" = ${id} AND ("budget_cap_iqd" IS NULL OR "spent_iqd" + ${amountIqd} <= "budget_cap_iqd")`;
    return n === 1;
  }

  async releaseSpend(id: string, amountIqd: number, tx?: Tx): Promise<void> {
    await this.db(tx).$executeRaw`
      UPDATE "public"."promotions" SET "spent_iqd" = GREATEST(0, "spent_iqd" - ${amountIqd}), "updated_at" = NOW() WHERE "id" = ${id}`;
  }
}
