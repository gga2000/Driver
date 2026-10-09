'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import type { SupportCustomer, TicketCase } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useMemo, useState } from 'react';
import { formatClock, formatDayClock, formatIqd, formatMoney, formatMonthYear } from '@/lib/format';
import { orderStateLabel, orderTypeLabel, paymentLabel } from '@/lib/labels';
import { fileUrl } from '@/lib/control-room';
import { eventTimeline } from '@/lib/orders';
import { API_URL } from '@/lib/trpc';
import { AccountName, OrderRef, OrgName, PersonName } from '../named';
import {
  Avatar,
  Button,
  Chip,
  cx,
  IconAlert,
  IconArrowUp,
  IconCheckCircle,
  IconDrivers,
  IconFlag,
  IconRefund,
  IconStore,
  Skeleton,
  Timeline,
} from '../ui';
import { statusTone } from './sla';

// Loads only on a case with a refund waiting for a second OK (Console speed budget).
const PendingRefundStrip = dynamic(() => import('../refund-approvals').then((m) => m.PendingRefundStrip));

export type SupportAction = 'refund' | 'fault' | 'escalate' | 'resolve';

/**
 * The context pane: the customer (first name, orders, lifetime value, refunds, earlier tickets),
 * the order (restaurant, items, courier, path, ledger) and the actions — four calm buttons, each
 * opening its own dialog. Sections are separated by hairlines, not boxed.
 */
export function ContextPane({
  data,
  customer,
  customerLoading,
  customerError = false,
  onAction,
}: {
  data: TicketCase;
  customer: SupportCustomer | null | undefined;
  customerLoading: boolean;
  customerError?: boolean;
  onAction: (a: SupportAction) => void;
}) {
  const closed = data.ticket.status === 'resolved';
  return (
    <aside
      aria-label={t('console.sup_customer')}
      className="h-full min-h-0 overflow-y-auto border-s border-line bg-surface"
    >
      <CustomerSection
        customer={customer}
        loading={customerLoading}
        error={customerError}
        name={data.ticket.customerName}
        currentId={data.ticket.id}
      />
      {!closed ? <ActionsSection data={data} onAction={onAction} /> : null}
      <OrderSection data={data} />
      <LedgerSection data={data} />
    </aside>
  );
}

function Section({
  title,
  children,
  aside,
  className,
}: {
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('border-b border-line px-5 py-4 last:border-b-0', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-dense font-semibold text-muted">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function CustomerSection({
  customer,
  loading,
  error,
  name,
  currentId,
}: {
  customer: SupportCustomer | null | undefined;
  loading: boolean;
  error: boolean;
  name: string | null;
  currentId: string;
}) {
  if (loading && customer === undefined) {
    return (
      <Section title={t('console.sup_customer')}>
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-pill" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      </Section>
    );
  }
  if (error && customer === undefined) {
    return (
      <Section title={t('console.sup_customer')}>
        <p className="text-sm text-muted">{name ?? t('console.sup_customer')}</p>
        <p className="mt-1 text-xs text-bad">{t('console.sup_customer_failed')}</p>
      </Section>
    );
  }
  if (!customer) {
    return (
      <Section title={t('console.sup_customer')}>
        <p className="text-sm text-muted">{t('console.sup_customer_none')}</p>
      </Section>
    );
  }
  const first = customer.firstName ?? name ?? t('console.sup_customer');
  return (
    <Section title={t('console.sup_customer')}>
      <div className="flex items-center gap-3">
        <Avatar name={first} id={customer.customerId} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{first}</p>
          <p className="text-dense text-muted">
            {customer.firstOrderAt
              ? t('console.sup_customer_since', { date: formatMonthYear(customer.firstOrderAt) })
              : t('console.sup_customer_new')}
          </p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-3 divide-x divide-x-reverse divide-line rounded-lg border border-line bg-surface-2/60">
        <Fact label={t('console.sup_customer_orders')} value={String(customer.orders)} />
        <Fact label={t('console.sup_customer_ltv')} value={formatIqd(customer.lifetimeIqd)} />
        <Fact
          label={t('console.sup_customer_refunded')}
          value={formatIqd(customer.refunded30dIqd)}
          tone={customer.refunded30dIqd > 0 ? 'warn' : undefined}
        />
      </dl>
      {customer.disputes30d > 1 ? (
        <p
          className={cx(
            'mt-3 flex items-center gap-2 rounded-md px-3 py-1.5 text-dense',
            customer.disputes30d > 3 ? 'bg-bad-tint text-bad' : 'bg-warn-tint text-warn',
          )}
        >
          <IconAlert size={15} className="shrink-0" />
          {t('console.sup_customer_disputes', { n: customer.disputes30d })}
        </p>
      ) : null}
      <h4 className="mb-1.5 mt-4 text-xs font-medium text-muted">
        {t('console.sup_customer_tickets')}
      </h4>
      {customer.recentTickets.length === 0 ? (
        <p className="text-dense text-faint">{t('console.sup_customer_first_ticket')}</p>
      ) : (
        <ul className="-mx-2">
          {customer.recentTickets
            .filter((r) => r.id !== currentId)
            .map((r) => (
              <li key={r.id}>
                <Link
                  href={`/support/${encodeURIComponent(r.id)}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1 truncate text-dense">{r.subject}</span>
                  <Chip tone={statusTone(r.status)} size="sm">
                    {r.status_ar}
                  </Chip>
                  <span className="num shrink-0 text-xs text-faint">
                    {formatDayClock(r.openedAt).split(' · ')[0]}
                  </span>
                </Link>
              </li>
            ))}
        </ul>
      )}
    </Section>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="min-w-0 px-3 py-2 text-center">
      <dt className="truncate text-xs text-muted">{label}</dt>
      <dd
        className={cx(
          'num mt-0.5 text-[15px] font-semibold',
          tone === 'warn' ? 'text-warn' : 'text-text',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function ActionsSection({
  data,
  onAction,
}: {
  data: TicketCase;
  onAction: (a: SupportAction) => void;
}) {
  const tk = data.ticket;
  return (
    <Section title={t('console.sup_actions')}>
      <div className="grid grid-cols-2 gap-2">
        <Button
          icon={<IconRefund size={16} />}
          onClick={() => onAction('refund')}
          className="justify-start"
        >
          {t('console.sup_act_refund')}
        </Button>
        <Button
          icon={<IconFlag size={16} />}
          onClick={() => onAction('fault')}
          className="justify-start"
        >
          {t('console.sup_act_fault')}
        </Button>
        <Button
          icon={<IconArrowUp size={16} />}
          onClick={() => onAction('escalate')}
          disabled={tk.status === 'escalated'}
          className="justify-start"
        >
          {t('console.sup_act_escalate')}
        </Button>
        <Button
          icon={<IconCheckCircle size={16} />}
          onClick={() => onAction('resolve')}
          kbd="E"
          className="justify-start"
        >
          {t('console.sup_act_resolve')}
        </Button>
      </div>
      {data.pendingApproval ? <PendingRefundStrip pending={data.pendingApproval} className="mt-3" /> : null}
      <dl className="mt-3 space-y-1 text-dense">
        <div className="flex justify-between gap-2">
          <dt className="text-muted">{t('console.sup_fault_now')}</dt>
          <dd className="font-medium">{t(`console.sup_fault_${tk.faultParty}` as MessageKey)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">{t('console.sup_refund')}</dt>
          <dd className="num">
            {t('console.sup_act_available', { amount: formatIqd(data.limits.availableIqd) })}
          </dd>
        </div>
        {tk.refundedIqd > 0 ? (
          <div className="flex justify-between gap-2">
            <dt className="text-muted">{t('console.sup_refunded_short')}</dt>
            <dd className="num font-semibold text-ok">{formatMoney(tk.refundedIqd)}</dd>
          </div>
        ) : null}
      </dl>
    </Section>
  );
}

const KEY_STEPS = new Set([
  'order.placed',
  'order.merchant_accepted',
  'order.ready',
  'order.picked_up',
  'order.delivered',
  'order.disputed',
  'order.closed',
  'order.customer_cancelled',
  'trip.picked_up',
  'trip.delivered',
]);

function OrderSection({ data }: { data: TicketCase }) {
  const o = data.order;
  const [all, setAll] = useState(false);
  const events = useMemo(() => eventTimeline(data.timeline), [data.timeline]);
  if (!o) {
    return (
      <Section title={t('console.sup_order')}>
        <p className="text-sm text-muted">{t('console.sup_no_order')}</p>
      </Section>
    );
  }
  const key = events.filter((e) => KEY_STEPS.has(e.type));
  const shown = all ? events : key.length > 0 ? key : events.slice(-5);
  return (
    <Section
      title={t('console.sup_order')}
      aside={<Chip size="sm">{orderStateLabel(o.state)}</Chip>}
    >
      <div className="flex items-baseline justify-between gap-2">
        <OrderRef id={o.id} strong className="text-lg" />
        <span className="text-dense text-muted">
          {orderTypeLabel(o.type)} · {paymentLabel(o.paymentMethod)}
        </span>
      </div>
      <ul className="mt-3 space-y-1.5 text-dense">
        {o.merchantOrgId ? (
          <li className="flex items-center gap-2">
            <IconStore size={15} className="shrink-0 text-muted" />
            {o.merchantName ? (
              <span>{o.merchantName}</span>
            ) : (
              <OrgName id={o.merchantOrgId} copy={false} />
            )}
          </li>
        ) : null}
        <li className="flex items-center gap-2">
          <IconDrivers size={15} className="shrink-0 text-muted" />
          {o.courierId ? (
            <PersonName
              id={o.courierId}
              vehicle
              copy={false}
              href={`/drivers/${encodeURIComponent(o.courierId)}/ledger`}
            />
          ) : (
            <span className="text-muted">—</span>
          )}
        </li>
      </ul>
      {o.lines.length > 0 ? (
        <ul className="mt-3 divide-y divide-line/70 rounded-lg border border-line text-dense">
          {o.lines.map((l, i) => (
            <li
              key={`${l.name}-${i}`}
              className="flex items-baseline justify-between gap-2 px-3 py-1.5"
            >
              <span className="min-w-0 truncate">
                <span className="num text-muted">{l.qty} ×</span> {l.name}
              </span>
              <span className="num shrink-0 text-muted">{formatIqd(l.totalIqd)}</span>
            </li>
          ))}
          <li className="flex items-baseline justify-between gap-2 bg-surface-2/60 px-3 py-1.5 font-semibold">
            <span>{t('console.sup_order_total')}</span>
            <span className="num">{formatMoney(o.totalIqd)}</span>
          </li>
        </ul>
      ) : null}
      {o.handoverPhotoUrl ? (
        // Maps program f11: the courier's delivery photo, the first evidence in "I never got it".
        <figure className="mt-3" data-testid="sup-handover-photo">
          <a href={fileUrl(o.handoverPhotoUrl, API_URL)} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed API URLs, not static assets */}
            <img src={fileUrl(o.handoverPhotoUrl, API_URL)} alt={t('console.sup_handover_photo')} className="aspect-[4/3] w-full rounded-lg border border-line object-cover" />
          </a>
          <figcaption className="mt-1 text-xs text-muted">{t('console.sup_handover_photo_note')}</figcaption>
        </figure>
      ) : null}
      {events.length > 0 ? (
        <>
          <h4 className="mb-2 mt-4 text-xs font-medium text-muted">
            {t('console.sup_order_events')}
          </h4>
          <Timeline
            items={shown.map((e, i) => ({
              id: e.id,
              title: e.label,
              time: formatClock(e.at),
              current: i === shown.length - 1 && !all,
              tone: e.quarantined ? 'bad' : undefined,
            }))}
          />
          {events.length > shown.length || all ? (
            <button
              type="button"
              onClick={() => setAll((a) => !a)}
              className="mt-2 text-dense font-medium text-accent-text hover:underline"
            >
              {all
                ? t('console.sup_order_events_less')
                : t('console.sup_order_events_all', { n: events.length })}
            </button>
          ) : null}
        </>
      ) : null}
    </Section>
  );
}

function LedgerSection({ data }: { data: TicketCase }) {
  if (!data.order) return null;
  return (
    <Section title={t('console.sup_ledger')}>
      {data.ledger.length === 0 ? (
        <p className="text-dense text-faint">{t('console.sup_no_ledger')}</p>
      ) : (
        <ul className="space-y-2 text-dense">
          {data.ledger.map((l) => {
            const support = l.memo?.startsWith('support:');
            return (
              <li key={l.id} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">
                  <span className={support ? 'font-semibold text-accent-text' : ''}>
                    {l.label_ar}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    <AccountName account={l.fromAccount} /> ← <AccountName account={l.toAccount} />
                  </span>
                </span>
                <span className="num shrink-0">{formatIqd(l.amountIqd)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
