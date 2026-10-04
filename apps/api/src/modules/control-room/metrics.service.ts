import { Inject, Injectable } from '@nestjs/common';
import type { LaunchMetric, LaunchMetricsView } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { localDateKey, startOfLocalDay } from '../../shared/local-time.js';
import { DispatchService } from '../dispatch/index.js';
import { OrdersService } from '../orders/index.js';
import { RoutesRpc } from '../routes/index.js';
import { SupportService } from '../support/index.js';
import { FinanceDeskService } from './finance.service.js';

/** Launch playbook §6 targets. */
export const WEEK_ONE_TARGETS = {
  medianDeliveryMin: 35,
  acceptanceRate: 0.85,
  disputesOver24h: 0,
  ordersPerDayByDay7: 30,
  rajaaSeats: 20,
} as const;

const DAY_MS = 86_400_000;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * The week-one metrics wall (launch playbook §6): median delivery < 35 min, acceptance > 85 %,
 * zero disputes unresolved > 24 h, 30+ orders/day by day 7, 20+ الرجعة seats booked, ledger
 * balanced every night. The window is the launch week (`since`, default the last 7 local days).
 */
@Injectable()
export class LaunchMetricsService {
  constructor(
    private readonly orders: OrdersService,
    private readonly dispatch: DispatchService,
    private readonly routes: RoutesRpc,
    private readonly support: SupportService,
    private readonly finance: FinanceDeskService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async wall(input: { cityId: string; since?: Date | undefined }): Promise<LaunchMetricsView> {
    const now = this.clock.now();
    const since = input.since ?? new Date(startOfLocalDay(now).getTime() - 6 * DAY_MS);
    const day = Math.max(1, Math.floor((startOfLocalDay(now).getTime() - startOfLocalDay(since).getTime()) / DAY_MS) + 1);
    const [durations, offers, tickets, perDay, seats, nightly] = await Promise.all([
      this.orders.deliveryDurations(input.cityId, since, now),
      this.dispatch.offerOutcomes(since),
      this.support.overdue(input.cityId),
      this.orders.placedPerDay(input.cityId, since, now),
      this.routes.seatsBookedSince(since),
      this.finance.nightly(),
    ]);
    const med = median(durations);
    const answered = offers.accepted + offers.declined + offers.timedOut;
    const acceptance = answered > 0 ? offers.accepted / answered : null;
    const ordersByDay: LaunchMetricsView['ordersByDay'] = [];
    for (let t = startOfLocalDay(since).getTime(); t <= now.getTime(); t += DAY_MS) {
      const key = localDateKey(new Date(t));
      ordersByDay.push({ date: key, orders: perDay.get(key) ?? 0 });
    }
    const today = ordersByDay.at(-1)?.orders ?? 0;
    const ledgerOk = nightly.ok && (nightly.lastClose?.ok ?? true);
    const byDay7 = (ok: boolean) => (ok ? true : day >= 7 ? false : null);
    const metrics: LaunchMetric[] = [
      {
        key: 'median_delivery',
        label_ar: 'وسيط وقت التوصيل',
        value: med === null ? null : Math.round(med * 10) / 10,
        display: med === null ? '—' : `${Math.round(med)} د`,
        target_ar: `أقل من ${WEEK_ONE_TARGETS.medianDeliveryMin} دقيقة`,
        ok: med === null ? null : med < WEEK_ONE_TARGETS.medianDeliveryMin,
        hint_ar: durations.length > 0 ? `${durations.length} طلب موصول` : 'ماكو طلبات موصولة بعد',
      },
      {
        key: 'acceptance',
        label_ar: 'نسبة القبول',
        value: acceptance,
        display: acceptance === null ? '—' : `${Math.round(acceptance * 100)}%`,
        target_ar: `أكثر من ${Math.round(WEEK_ONE_TARGETS.acceptanceRate * 100)}%`,
        ok: acceptance === null ? null : acceptance > WEEK_ONE_TARGETS.acceptanceRate,
        hint_ar: `${offers.accepted} مقبول من ${answered} عرض`,
      },
      {
        key: 'disputes_24h',
        label_ar: 'شكاوى معلّقة فوق 24 ساعة',
        value: tickets.overdue24h,
        display: String(tickets.overdue24h),
        target_ar: 'صفر',
        ok: tickets.overdue24h <= WEEK_ONE_TARGETS.disputesOver24h,
        hint_ar: `${tickets.open} تذكرة مفتوحة`,
      },
      {
        key: 'orders_day',
        label_ar: 'طلبات اليوم',
        value: today,
        display: String(today),
        target_ar: `${WEEK_ONE_TARGETS.ordersPerDayByDay7}+ باليوم السابع`,
        ok: byDay7(today >= WEEK_ONE_TARGETS.ordersPerDayByDay7),
        hint_ar: `اليوم ${day} من الأسبوع الأول`,
      },
      {
        key: 'rajaa_seats',
        label_ar: 'مقاعد الرجعة المحجوزة',
        value: seats,
        display: String(seats),
        target_ar: `${WEEK_ONE_TARGETS.rajaaSeats}+ بالأسبوع`,
        ok: byDay7(seats >= WEEK_ONE_TARGETS.rajaaSeats),
        hint_ar: 'من بداية الأسبوع',
      },
      {
        key: 'ledger',
        label_ar: 'الدفتر',
        value: nightly.moneyNet,
        display: ledgerOk ? 'متوازن' : 'مو متوازن',
        target_ar: 'متوازن كل ليلة',
        ok: ledgerOk,
        hint_ar: nightly.lastClose ? `آخر إغلاق ${nightly.lastClose.day}: ${nightly.lastClose.ok ? 'متوازن' : 'فيه فرق'}` : 'ماكو إغلاق ليلي مسجّل بعد',
      },
    ];
    return { cityId: input.cityId, at: now, since, day, metrics, ordersByDay, deliverySamples: durations.length, offers: { accepted: offers.accepted, answered }, openTickets: tickets.open };
  }
}
