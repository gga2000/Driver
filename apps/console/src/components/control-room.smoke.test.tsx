import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ApprovalItem, ControlsView, FinanceDeskView, LaunchMetricsView, SupportCustomer, SystemBannerView, TicketCase, TicketSummary } from '@driver/contracts';
import { makeTrpcClient, TRPCProvider } from '@/lib/trpc';
import { ApprovalsBoard } from './approvals-page';
import { ControlsBoard } from './controls-page';
import { FinanceDesk } from './finance-page';
import { viewCounts } from '@/lib/support-views';
import { SupportActionDialogs } from './support/actions';
import { ContextPane } from './support/context';
import { Conversation } from './support/conversation';
import { SupportQueue } from './support/queue';
import { ToastProvider } from './ui';
import { Wall } from './wall-page';

/** Page smoke tests: every control-room page body renders from realistic data (server render, no API). */

const AT = new Date('2026-10-04T18:30:00Z'); // 21:30 Baghdad
const LATER = new Date('2026-10-04T21:00:00Z');

function wrap(ui: ReactNode): string {
  const queryClient = new QueryClient();
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={makeTrpcClient()} queryClient={queryClient}>
        {ui}
      </TRPCProvider>
    </QueryClientProvider>,
  );
}

const zone = (zoneKey: string, name_ar: string, over: Partial<ControlsView['zones'][number]> = {}): ControlsView['zones'][number] => ({
  zoneKey,
  name_ar,
  tier: 'near',
  maxActive: null,
  mode: 'refuse',
  etaMin: 15,
  active: 0,
  load: 0,
  state: 'ok',
  killed: false,
  setBy: null,
  setAt: null,
  ...over,
});

const controls: ControlsView = {
  cityId: 'aziziyah',
  at: AT,
  switches: [
    { id: 'ks1', cityId: 'aziziyah', scope: 'zone', key: 'khamas', label_ar: 'الخماس', vertical: null, active: true, holdDispatch: true, message_ar: 'الطريق للخماس مسدود بسبب المطر', reason: 'مطر قوي', setBy: 'p1', setByName: 'علي', setAt: AT, expiresAt: LATER },
    { id: 'ks2', cityId: 'aziziyah', scope: 'vertical', key: 'parcel', label_ar: 'الطرود', vertical: null, active: false, holdDispatch: false, message_ar: null, reason: 'رجعت', setBy: 'p1', setByName: 'علي', setAt: AT, expiresAt: null },
  ],
  zones: [zone('zakur', 'زاكور', { maxActive: 6, active: 6, load: 1, state: 'full' }), zone('centre', 'العزيزية (مركز)', { maxActive: 10, active: 8, load: 0.8, state: 'busy' }), zone('khamas', 'الخماس', { killed: true, state: 'off' })],
  verticals: [
    { key: 'food', label_ar: 'الأكل', killed: false },
    { key: 'parcel', label_ar: 'الطرود', killed: false },
  ],
  restaurants: [{ key: 'org_1', label_ar: 'مطعم خالد', killed: false }],
  corridors: [{ key: 'aziziyah_baghdad', label_ar: 'العزيزية ⇄ بغداد', killed: false }],
  activeOrders: 14,
};

const banner: SystemBannerView = { id: 'bn1', cityId: null, severity: 'warning', audiences: ['customer', 'partner'], message_ar: 'المطر قوي، التوصيل يتأخر شوية', message_en: null, startsAt: AT, expiresAt: LATER, active: true, setBy: 'p1', setByName: 'علي', setAt: AT, clearedAt: null };

const ticket: TicketSummary = {
  id: 'tk_1',
  cityId: 'aziziyah',
  kind: 'dispute',
  kind_ar: 'نزاع',
  status: 'open',
  status_ar: 'مفتوحة',
  channel: 'in_app',
  subject: 'الطلب تأخّر أو وصل بارد',
  orderId: 'ord_123456789',
  tripId: 'trp_1',
  customerId: 'c1',
  customerName: 'زينب',
  openedAt: new Date('2026-10-04T17:50:00Z'),
  firstResponseAt: null,
  resolvedAt: null,
  slaDueAt: LATER,
  slaState: 'ok',
  overdue24h: false,
  urgency: 64,
  urgencyReasons: ['طلب شغّال هسة', 'زعلان'],
  assigneeId: null,
  faultParty: 'none',
  refundedIqd: 0,
  escalatedTo: null,
  lastActivityAt: AT,
};

describe('control room pages render', () => {
  it('controls: switches, the stopped list, zone gauges, the banner composer and the log', () => {
    const html = wrap(
      <ControlsBoard
        view={controls}
        audit={[{ id: 'au1', at: AT, actorId: 'p1', actorName: 'علي', action: 'kill_switch.on', subjectKind: 'kill_switch', subjectId: 'zone:khamas:*', summary_ar: 'وقّف الخماس: مطر قوي', detail: {} }]}
        banners={[banner]}
        canSwitch
        canBanner
        onSwitch={() => undefined}
        onZone={() => undefined}
        policies={[{ vertical: 'food', policy: 'smart_broadcast', suggestOnly: false, overridden: true }]}
        onPolicy={() => undefined}
      />,
    );
    for (const text of [
      'الخدمات بكل المدينة',
      'الموقّف هسة',
      'الطريق للخماس مسدود بسبب المطر',
      'يرجع وحده الساعة 12:00 ص',
      'المناطق والخدمات',
      'زاكور',
      'ممتلئ',
      'مزدحم',
      'role="switch"',
      'طريقة التوزيع',
      'رجّعه للإعداد',
      'إعلان لكل التطبيقات',
      'المطر قوي، التوصيل يتأخر شوية',
      'درايفر للسواق',
      'سجل التحكّم',
      'وقّف الخماس: مطر قوي',
      'مطعم خالد',
      'العزيزية ⇄ بغداد',
    ]) {
      expect(html).toContain(text);
    }
    // Full zones first in the matrix.
    expect(html.indexOf('زاكور')).toBeLessThan(html.indexOf('العزيزية (مركز)'));
  });

  it('approvals: the queue with filters and the side-by-side detail; own items say so', () => {
    const item = (over: Partial<ApprovalItem>): ApprovalItem => ({
      id: 'driver_document:d1',
      kind: 'driver_document',
      kind_ar: 'مستمسك سايق',
      refId: 'd1',
      title_ar: 'إجازة السياقة',
      subtitle_ar: null,
      submittedAt: new Date('2026-10-04T17:00:00Z'),
      submittedBy: 'p2',
      submittedByName: 'حيدر',
      ownItem: false,
      photos: [{ url: '/files/up_1?exp=1&sig=x', label_ar: 'إجازة السياقة' }],
      compare: [{ url: '/files/up_2?exp=1&sig=y', label_ar: 'الهوية الوطنية (موافق عليه)' }],
      facts: [{ label_ar: 'النوع', value: 'إجازة السياقة' }],
      takesExpiry: true,
      ...over,
    });
    const html = wrap(
      <ApprovalsBoard
        items={[item({}), item({ id: 'landmark_photo:p1', kind: 'landmark_photo', kind_ar: 'صورة معلم', refId: 'p1', title_ar: 'معلم جديد: يم الجامع', ownItem: true, takesExpiry: false })]}
        now={AT}
        kind="all"
        onKind={() => undefined}
        selectedId={null}
        onSelect={() => undefined}
        audit={[]}
        onDecided={() => undefined}
      />,
    );
    for (const text of ['إجازة السياقة', 'قيد المراجعة', 'للمقارنة', 'الهوية الوطنية (موافق عليه)', 'وافق على المستمسك', 'ارفض', 'معلم جديد: يم الجامع', 'يخصّك', 'قبل 1 س']) expect(html).toContain(text);
    expect(html).toContain('http://localhost:3000/files/up_1');
  });

  it('support: the urgency-ranked queue with smart views and SLA fuses', () => {
    const html = wrap(
      <SupportQueue rows={[ticket]} counts={viewCounts([ticket], 'p1')} view="open" onView={() => undefined} query="" onQuery={() => undefined} selectedId="tk_1" onSelect={() => undefined} onNew={() => undefined} now={AT} seen={{}} />,
    );
    for (const text of ['الطلب تأخّر أو وصل بارد', 'زينب', 'باقي 2 س 30 د', 'طلب شغّال هسة', 'المفتوحة', 'جديد', 'data-ticket-row']) expect(html).toContain(text);
    expect(html).toContain('aria-selected="true"');
  });

  it('support case: thread, suggestion, customer card, order, actions, limits and ledger', () => {
    const data: TicketCase = {
      ticket,
      entries: [
        { id: 'e1', at: ticket.openedAt, actorId: 'c1', actorName: 'زينب', kind: 'opened', text: 'وصل بارد وبعد ساعة', amountIqd: null, meta: {} },
        { id: 'e2', at: AT, actorId: 'p1', actorName: 'علي', kind: 'note', text: 'نتأكد من الدليفري أول', amountIqd: null, meta: {} },
        { id: 'e3', at: AT, actorId: 'p1', actorName: 'علي', kind: 'refund', text: '1,000 دينار رصيد بالمحفظة', amountIqd: 1000, meta: {} },
      ],
      order: { id: 'ord_123456789', type: 'food', state: 'disputed', totalIqd: 6500, paymentMethod: 'cash', merchantOrgId: 'org_1', merchantName: 'مطعم خالد', placedAt: ticket.openedAt, deliveredAt: AT, courierId: 'd1', lines: [{ name: 'وجبة كبد', qty: 1, totalIqd: 5000 }] },
      timeline: [],
      ledger: [{ id: 'le1', at: AT, type: 'credit_issued', label_ar: 'رصيد مضاف', amountIqd: 1000, fromAccount: 'platform', toAccount: 'customer:c1', memo: 'support:tk_1:platform' }],
      chatKinds: [],
      limits: { agentDailyCapIqd: 10_000, agentUsedTodayIqd: 1000, customerMonthlyCapIqd: 25_000, customerUsedMonthIqd: 1000, escalateAboveIqd: 25_000, availableIqd: 5500, cashAboveIqd: 10_000 },
      canned: [{ key: 'late_sorry', title_ar: 'تأخير', text_ar: 'حقّك علينا', action: 'refund', amountIqd: 1000 }],
      suggestion: { cannedKey: 'late_sorry', reason_ar: 'شكوى تأخير' },
      customerDisputes30d: 4,
    };
    const customer: SupportCustomer = {
      customerId: 'c1',
      firstName: 'زينب',
      orders: 12,
      delivered: 11,
      cancelled: 1,
      lifetimeIqd: 148_000,
      firstOrderAt: new Date('2026-09-02T12:00:00Z'),
      lastOrderAt: AT,
      refunded30dIqd: 1000,
      disputes30d: 4,
      recentTickets: [{ id: 'tk_0', subject: 'الدليفري ما رجّع الباقي', kind: 'complaint', kind_ar: 'شكوى', status: 'resolved', status_ar: 'محلولة', openedAt: new Date('2026-09-20T12:00:00Z'), refundedIqd: 0 }],
    };
    const html = wrap(
      <ToastProvider>
        <Conversation data={data} now={AT} composerRef={null} onCanned={() => undefined} />
        <ContextPane data={data} customer={customer} customerLoading={false} onAction={() => undefined} />
        <SupportActionDialogs data={data} open={null} onClose={() => undefined} prefill={null} />
      </ToastProvider>,
    );
    for (const text of [
      'وصل بارد وبعد ساعة',
      'ملاحظة داخلية · ما يشوفها الزبون',
      'تعويض',
      'المقترح',
      'تأخير',
      'وجبة كبد',
      'مطعم خالد',
      'رصيد مضاف',
      'تگدر تعوّض لحد 5,500 دينار',
      'صعّد لعلي',
      'المراجعة يدوية',
      'زبون من أيلول 2026',
      '148,000',
      'الدليفري ما رجّع الباقي',
      'data-composer',
    ])
      expect(html).toContain(text);
  });

  it('finance: the ledger check, the 23:00 round with its map, hand-overs, couriers and merchants', () => {
    const desk: FinanceDeskView = {
      cityId: 'aziziyah',
      at: AT,
      localDate: '2026-10-04',
      couriers: [{ driverId: 'd1', name: 'مرتضى', zoneKey: 'zakur', zone_ar: 'زاكور', online: true, heldIqd: 48_000, owedIqd: 52_000, capIqd: 75_000, fill: 0.69, overCap: false, tier: 'bronze' }],
      merchants: [{ merchantId: 'org_1', name: 'مطعم خالد', payableIqd: 120_000, mode: 'nightly_courier', exposureCapIqd: 300_000, overExposure: false }],
      handovers: [{ at: AT, kind: 'courier_to_merchant', courierId: 'd1', courierName: 'مرتضى', counterpart: 'مطعم خالد', amountIqd: 30_000, reference: 'h1' }],
      round: { at: LATER, stops: [{ seq: 1, zoneKey: 'zakur', zone_ar: 'زاكور', couriers: [{ driverId: 'd1', name: 'مرتضى', heldIqd: 48_000, overCap: false }], totalIqd: 48_000 }], totalIqd: 48_000 },
      nightly: { ok: true, message_ar: 'الدفتر متوازن', moneyNet: 0, pointsNet: 0, kindViolations: 0, checkedAt: AT, lastClose: null },
      totals: { cashInFieldIqd: 48_000, merchantsPayableIqd: 120_000, collectedTodayIqd: 30_000, couriersOverCap: 0 },
    };
    const html = wrap(<FinanceDesk desk={desk} />);
    for (const text of ['الدفتر متوازن', 'ماكو فرق', 'جولة الساعة', 'زاكور', 'مرتضى', 'مطعم خالد', '48,000', 'لازم يسلّم 52,000 دينار', 'للمطعم 120,000 دينار', 'سلّم 30,000 دينار لمطعم خالد', 'تسليمات اليوم', 'خريطة الجولة']) expect(html).toContain(text);
    // Words, not signs (K-16).
    expect(html).not.toMatch(/\d,\d{3}-/);
  });

  it('wall: six metrics against the playbook targets and orders per day', () => {
    const data: LaunchMetricsView = {
      cityId: 'aziziyah',
      at: AT,
      since: new Date('2026-09-28T21:00:00Z'),
      day: 7,
      metrics: [
        { key: 'median_delivery', label_ar: 'وسيط وقت التوصيل', value: 31, display: '31 د', target_ar: 'أقل من 35 دقيقة', ok: true, hint_ar: '120 طلب موصول' },
        { key: 'acceptance', label_ar: 'نسبة القبول', value: 0.8, display: '80%', target_ar: 'أكثر من 85%', ok: false, hint_ar: null },
        { key: 'disputes_24h', label_ar: 'شكاوى معلّقة فوق 24 ساعة', value: 0, display: '0', target_ar: 'صفر', ok: true, hint_ar: null },
        { key: 'orders_day', label_ar: 'طلبات اليوم', value: 34, display: '34', target_ar: '30+ باليوم السابع', ok: true, hint_ar: null },
        { key: 'rajaa_seats', label_ar: 'مقاعد الرجعة المحجوزة', value: 12, display: '12', target_ar: '20+ بالأسبوع', ok: null, hint_ar: null },
        { key: 'ledger', label_ar: 'الدفتر', value: 0, display: 'متوازن', target_ar: 'متوازن كل ليلة', ok: true, hint_ar: null },
      ],
      ordersByDay: ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((date, i) => ({ date, orders: 10 + i * 4 })),
      deliverySamples: 120,
      offers: { accepted: 80, answered: 100 },
      openTickets: 2,
    };
    const html = wrap(<Wall data={data} />);
    for (const text of ['الأسبوع الأول', 'وسيط وقت التوصيل', '31 د', 'على الهدف', 'بعيد عن الهدف', 'بعد وكت', 'الطلبات باليوم', '4 من 6', 'الهدف 30 طلب باليوم', 'اليوم']) expect(html).toContain(text);
  });
});
