import { Inject, Injectable } from '@nestjs/common';
import { DriverError, type DealBadge, type DealSchedule, type DealState, type DealType, type DealView } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { localDow } from '../../shared/local-time.js';
import { EventsService } from '../events/index.js';
import { dealBadge, inDealHours } from './deal-pricing.js';
import { PROMOTIONS_REPOSITORY, type DealProjection, type DealRecord, type PromotionsRepository } from './promotions.repository.js';

const DAY_MS = 86_400_000;
/** Days of order history the projection reads. */
export const PROJECTION_BASIS_DAYS = 28;
const COUNTED_STATES = new Set(['merchant_accepted', 'preparing', 'ready', 'picked_up', 'delivered', 'closed', 'disputed']);

/** What the projection needs of a past order. */
export interface OrderSample {
  placedAt: Date;
  state: string;
  itemsTotalIqd: number;
  deliveryFeeIqd: number;
  lines: ReadonlyArray<{ catalogItemId: string | null; qty: number; unitPriceIqd: number }>;
}

export interface DealProposal {
  type: DealType;
  value: number;
  itemIds: readonly string[];
  schedule: DealSchedule;
  minOrderIqd: number;
  budgetCapIqd?: number | undefined;
}


/**
 * Projected cost of a merchant deal (merchant app "projected cost"), server-side from the merchant's
 * last 28 days of orders: orders that would have qualified (schedule days and hours, minimum, covered
 * items) per week × what the deal would have cost on each, over the deal's weeks, capped by budget.
 */
export function projectDeal(orders: readonly OrderSample[], deal: DealProposal, now: Date): DealProjection {
  const since = now.getTime() - PROJECTION_BASIS_DAYS * DAY_MS;
  const basis = orders.filter((o) => COUNTED_STATES.has(o.state) && o.placedAt.getTime() >= since && o.placedAt.getTime() <= now.getTime());
  const items = new Set(deal.itemIds);
  let qualifying = 0;
  let cost = 0;
  for (const o of basis) {
    if (deal.schedule.days.length > 0 && !deal.schedule.days.includes(localDow(o.placedAt))) continue;
    if (!inDealHours(o.placedAt, deal.schedule.hours)) continue;
    if (o.itemsTotalIqd < deal.minOrderIqd) continue;
    const covered = items.size === 0 ? o.lines : o.lines.filter((l) => l.catalogItemId !== null && items.has(l.catalogItemId));
    if (covered.length === 0) continue;
    const coveredIqd = covered.reduce((s, l) => s + l.qty * l.unitPriceIqd, 0);
    let c = 0;
    if (deal.type === 'percent') c = Math.round((coveredIqd * deal.value) / 100);
    else if (deal.type === 'fixed') c = Math.min(deal.value, coveredIqd);
    else if (deal.type === 'free_delivery') c = o.deliveryFeeIqd;
    else c = Math.min(...covered.map((l) => l.unitPriceIqd));
    qualifying += 1;
    cost += c;
  }
  const weeks = PROJECTION_BASIS_DAYS / 7;
  const ordersPerWeek = Math.round((qualifying / weeks) * 10) / 10;
  const costPerOrderIqd = qualifying > 0 ? Math.round(cost / qualifying) : 0;
  const weeklyCostIqd = Math.round(cost / weeks);
  const dealWeeks = Math.max(0, deal.schedule.endsAt.getTime() - deal.schedule.startsAt.getTime()) / (7 * DAY_MS);
  const total = Math.round(weeklyCostIqd * dealWeeks);
  return { ordersPerWeek, costPerOrderIqd, weeklyCostIqd, totalCostIqd: deal.budgetCapIqd ? Math.min(total, deal.budgetCapIqd) : total, basisOrders: basis.length };
}

const STATE_AR: Record<DealState, string> = {
  pending_approval: 'بانتظار موافقة المنصة',
  approved: 'شغّال',
  rejected: 'مرفوض',
  paused: 'موقّف',
  ended: 'منتهي',
};

export function dealState(d: DealRecord, now: Date): DealState {
  if (d.proposalState === 'rejected') return 'rejected';
  if (d.schedule.endsAt.getTime() <= now.getTime()) return 'ended';
  if (d.proposalState === 'pending_approval') return 'pending_approval';
  return d.active ? 'approved' : 'paused';
}

export function dealView(d: DealRecord, now: Date): DealView {
  const state = dealState(d, now);
  return {
    dealId: d.id,
    merchantOrgId: d.merchantOrgId,
    nameAr: d.nameAr,
    type: d.type,
    value: d.value,
    itemIds: [...d.itemIds],
    schedule: d.schedule,
    minOrderIqd: d.minOrderIqd,
    budgetCapIqd: d.budgetCapIqd,
    spentIqd: d.spentIqd,
    projected: d.projection,
    state,
    state_ar: STATE_AR[state],
    active: state === 'approved' && d.schedule.startsAt.getTime() <= now.getTime() && (d.budgetCapIqd === null || d.spentIqd < d.budgetCapIqd),
    funder: 'merchant',
    createdAt: d.createdAt,
  };
}

/**
 * Promotions (domain §11) — today: merchant self-serve deals. Each deal is a `promotions` row
 * (funder = merchant) with its projected cost, waiting for platform approval when the city's switch
 * says so. Orders reach them through `PromotionsPort` (`orders/promotions.adapter.ts`): live deals for
 * the storefront badge and the checkout quote, and the spend counter reserved in the order's own
 * unit of work (atomic against the budget cap) and released when the order is cancelled.
 */
@Injectable()
export class PromotionsService {
  constructor(
    @Inject(PROMOTIONS_REPOSITORY) private readonly repo: PromotionsRepository,
    private readonly events: EventsService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  validate(p: DealProposal, rules: { maxPercent: number; maxDays: number }): void {
    const now = this.clock.now();
    const bad =
      (p.type === 'percent' && (p.value < 1 || p.value > rules.maxPercent)) ||
      (p.type === 'fixed' && (p.value <= 0 || p.value % 250 !== 0)) ||
      (p.type === 'bogo' && p.itemIds.length === 0) ||
      p.schedule.endsAt.getTime() <= p.schedule.startsAt.getTime() ||
      p.schedule.endsAt.getTime() <= now.getTime() ||
      p.schedule.endsAt.getTime() - p.schedule.startsAt.getTime() > rules.maxDays * DAY_MS ||
      (p.schedule.hours !== undefined && p.schedule.hours.start === p.schedule.hours.end);
    if (bad) throw new DriverError('deal_invalid');
  }

  async propose(input: DealProposal & { cityId: string; merchantOrgId: string; ownerId: string; nameAr: string; projection: DealProjection; requireApproval: boolean }): Promise<DealView> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const deal = await this.repo.createDeal(
        {
          cityId: input.cityId,
          merchantOrgId: input.merchantOrgId,
          ownerId: input.ownerId,
          nameAr: input.nameAr,
          type: input.type,
          value: input.type === 'percent' || input.type === 'fixed' ? input.value : 0,
          itemIds: [...input.itemIds],
          schedule: input.schedule,
          minOrderIqd: input.minOrderIqd,
          budgetCapIqd: input.budgetCapIqd ?? null,
          spentIqd: 0,
          projection: input.projection,
          proposalState: input.requireApproval ? 'pending_approval' : 'approved',
          active: true,
          approvedAt: input.requireApproval ? null : now,
          createdAt: now,
        },
        tx,
      );
      await this.events.emit(
        tx,
        { actorId: input.ownerId, type: 'promotion.deal_proposed', occurredAt: now, payload: { dealId: deal.id, merchantOrgId: deal.merchantOrgId, type: deal.type, value: deal.value, projectedCostIqd: deal.projection.totalCostIqd, needsApproval: input.requireApproval } },
        { name: 'promotion', id: deal.id },
      );
      return dealView(deal, now);
    });
  }

  async list(merchantOrgId: string): Promise<DealView[]> {
    const now = this.clock.now();
    return (await this.repo.dealsOf(merchantOrgId)).map((d) => dealView(d, now));
  }

  /** Every deal of a merchant as stored (the checkout evaluates liveness and budget per order). */
  async dealsOf(merchantOrgId: string, tx?: Tx): Promise<DealRecord[]> {
    return this.repo.dealsOf(merchantOrgId, tx);
  }

  /** Live deals with budget left, as customer badges (approved, on, in schedule now). */
  async badges(merchantOrgId: string, at: Date = this.clock.now()): Promise<DealBadge[]> {
    const deals = (await this.repo.dealsOf(merchantOrgId)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    return deals.map((d) => dealBadge(d, at)).filter((b): b is DealBadge => b !== null);
  }

  /** Atomic check-and-increment of the deal's spend inside the caller's unit of work; false = cap reached. */
  reserveSpend(dealId: string, amountIqd: number, tx?: Tx): Promise<boolean> {
    return this.repo.reserveSpend(dealId, amountIqd, tx);
  }

  releaseSpend(dealId: string, amountIqd: number, tx?: Tx): Promise<void> {
    return this.repo.releaseSpend(dealId, amountIqd, tx);
  }

  /** Deals waiting for platform approval, oldest first (Console approvals queue). */
  pendingDeals(limit = 200): Promise<DealRecord[]> {
    return this.repo.pendingDeals(limit);
  }

  async get(dealId: string): Promise<DealRecord> {
    const d = await this.repo.deal(dealId);
    if (!d) throw new DriverError('deal_not_found');
    return d;
  }

  /** The merchant's on/off switch (a pending deal keeps its intent; a rejected or ended one cannot change). */
  async setActive(merchantOrgId: string, dealId: string, active: boolean, actorId: string): Promise<DealView> {
    const d = await this.get(dealId);
    if (d.merchantOrgId !== merchantOrgId) throw new DriverError('deal_not_found');
    const now = this.clock.now();
    const state = dealState(d, now);
    if (state === 'rejected' || state === 'ended') throw new DriverError('deal_state_conflict');
    if (d.active === active) return dealView(d, now);
    return this.uow.run(async (tx) => {
      const updated = await this.repo.updateDeal(dealId, { active }, tx);
      await this.events.emit(tx, { actorId, type: active ? 'promotion.deal_resumed' : 'promotion.deal_paused', occurredAt: now, payload: { dealId, merchantOrgId } }, { name: 'promotion', id: dealId });
      return dealView(updated, now);
    });
  }

  /** Platform approval switch (admin / support). */
  async review(dealId: string, approve: boolean, reviewerId: string, reason?: string): Promise<DealView> {
    const d = await this.get(dealId);
    const now = this.clock.now();
    if (d.proposalState !== 'pending_approval') throw new DriverError('deal_state_conflict');
    // Separation of duties: whoever proposed a deal never approves it (launch control room).
    if (d.ownerId === reviewerId) throw new DriverError('approval_own_item');
    return this.uow.run(async (tx) => {
      const updated = await this.repo.updateDeal(dealId, { proposalState: approve ? 'approved' : 'rejected', approvedAt: approve ? now : null }, tx);
      await this.events.emit(
        tx,
        { actorId: reviewerId, type: approve ? 'promotion.deal_approved' : 'promotion.deal_rejected', occurredAt: now, payload: { dealId, merchantOrgId: d.merchantOrgId, reason: reason ?? null } },
        { name: 'promotion', id: dealId },
      );
      return dealView(updated, now);
    });
  }
}
