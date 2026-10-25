'use client';

import Link from 'next/link';
import type { CustomerSegment, OrderSummary, ProfileSignal, ProfileTicket } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useState, type ReactNode } from 'react';
import { formatIqd } from '@/lib/format';
import { orderTypeLabel, zoneName } from '@/lib/labels';
import { segmentLabel, segmentTone, signalText } from '@/lib/people';
import { stamp } from '@/lib/periods';
import { OrderRef, OrgName } from '../named';
import { OrderStatus } from '../order-status';
import { NewTicketDialog } from '../support/new-ticket';
import { Button, Chip, cx, IconAlert, IconCheckCircle, IconClock, useNow, type ChipTone } from '../ui';

export function SegmentChip({ segment, size = 'sm' }: { segment: CustomerSegment; size?: 'sm' | 'md' }) {
  return (
    <Chip tone={segmentTone(segment)} size={size}>
      {segmentLabel(segment)}
    </Chip>
  );
}

const SIGNAL_MARK: Record<ProfileSignal['tone'], string> = {
  good: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  info: 'text-accent-text',
};

/** «شنو لازم تعرف»: the few facts worth saying before anything else, one sentence each. */
export function Signals({ signals, className }: { signals: readonly ProfileSignal[]; className?: string }) {
  if (signals.length === 0) return null;
  return (
    <ul className={cx('m-0 list-none space-y-1.5 p-0', className)}>
      {signals.map((s) => (
        <li key={s.key} className="flex items-start gap-2 text-sm leading-6">
          <span aria-hidden className={cx('mt-[3px] shrink-0', SIGNAL_MARK[s.tone])}>
            {s.tone === 'good' ? <IconCheckCircle size={16} /> : s.tone === 'info' ? <IconClock size={16} /> : <IconAlert size={16} />}
          </span>
          <span>{signalText(s)}</span>
        </li>
      ))}
    </ul>
  );
}

/** «هسة»: orders and rides going on right now, one line each, late ones in red. */
export function NowBar({ live }: { live: readonly OrderSummary[] }) {
  if (live.length === 0) return null;
  return (
    <section aria-label={t('console.ppl_now')} className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-accent/40 bg-accent-wash px-4 py-3">
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-accent-text">
        <span aria-hidden className="relative flex h-2.5 w-2.5">
          <span className="absolute inset-0 rounded-pill bg-accent motion-safe:animate-ping" />
          <span className="relative h-2.5 w-2.5 rounded-pill bg-accent" />
        </span>
        {t('console.ppl_now')}
      </span>
      {live.map((o) => (
        <span key={o.id} className="inline-flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{orderTypeLabel(o.type)}</span>
          <OrderRef id={o.id} copy={false} />
          {o.merchantOrgId ? <OrgName id={o.merchantOrgId} copy={false} /> : null}
          <OrderStatus state={o.state} size="sm" />
          {o.late && o.lateMin ? (
            <Chip tone="bad" size="sm">
              {t('console.ppl_now_late', { n: o.lateMin })}
            </Chip>
          ) : null}
        </span>
      ))}
    </section>
  );
}

/** Recent orders with «مشكلة؟» on each: a ticket opens already tied to that order and person. */
export function RecentOrders({ orders, customerId, compact = false }: { orders: readonly OrderSummary[]; customerId: string; compact?: boolean }) {
  const now = new Date(useNow(60_000));
  const [problem, setProblem] = useState<string | null>(null);
  if (orders.length === 0) return <p className="text-dense text-muted">{t('console.ppl_recent_none')}</p>;
  return (
    <>
      <ul className="m-0 list-none divide-y divide-line p-0">
        {orders.map((o) => (
          <li key={o.id} className={cx('flex flex-wrap items-center gap-x-3 gap-y-1', compact ? 'py-2' : 'py-2.5')}>
            <span className="min-w-0 flex-1 leading-5">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{o.merchantOrgId ? <OrgName id={o.merchantOrgId} copy={false} /> : orderTypeLabel(o.type)}</span>
                {compact ? null : <OrderStatus state={o.state} size="sm" />}
              </span>
              <span className="block text-xs text-muted">
                <OrderRef id={o.id} copy={false} /> · {stamp(o.placedAt, now)}
                {o.zoneKey && !compact ? ` · ${zoneName(o.zoneKey)}` : ''}
              </span>
            </span>
            <span className="num whitespace-nowrap text-dense">
              {formatIqd(o.totalIqd)} <span className="text-xs text-muted">{t('quote.currency')}</span>
            </span>
            {compact ? null : (
              <Button size="sm" variant="ghost" onClick={() => setProblem(o.id)}>
                {t('console.ppl_problem')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <NewTicketDialog open={problem !== null} onClose={() => setProblem(null)} customerId={customerId} {...(problem ? { orderId: problem } : {})} />
    </>
  );
}

const TICKET_TONE: Record<string, ChipTone> = { open: 'bad', waiting: 'warn', escalated: 'bad', resolved: 'done' };

export function TicketList({ tickets, empty, fault = false }: { tickets: ReadonlyArray<ProfileTicket & { faultParty?: string }>; empty: string; fault?: boolean }) {
  const now = new Date(useNow(60_000));
  if (tickets.length === 0) return <p className="text-dense text-muted">{empty}</p>;
  return (
    <ul className="m-0 list-none divide-y divide-line p-0">
      {tickets.map((k) => (
        <li key={k.id}>
          <Link href={`/support/${encodeURIComponent(k.id)}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 hover:bg-surface-2">
            <span className="min-w-0 flex-1 leading-5">
              <span className="block truncate font-medium">{k.subject}</span>
              <span className="block text-xs text-muted">
                {stamp(k.openedAt, now)}
                {k.refundedIqd > 0 ? ` · ${t('console.ppl_refunded', { amount: formatIqd(k.refundedIqd) })}` : ''}
              </span>
            </span>
            {fault && k.faultParty && k.faultParty !== 'none' ? (
              <Chip size="sm" tone={k.faultParty === 'courier' ? 'warn' : 'neutral'}>
                {t(`console.ppl_fault_${k.faultParty}` as MessageKey)}
              </Chip>
            ) : null}
            <Chip size="sm" tone={TICKET_TONE[k.status] ?? 'neutral'}>
              {t(`console.ppl_ticket_${k.status}` as MessageKey)}
            </Chip>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** A labelled block inside a card: small heading, then the content. */
export function Block({ title, hint, children, className }: { title: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <h3 className="mb-2 text-dense font-semibold text-text">
        {title}
        {hint ? <span className="ms-2 font-normal text-faint">{hint}</span> : null}
      </h3>
      {children}
    </div>
  );
}

/** «جديد · ويانا من ...» etc. joined with a middle dot. */
export function Facts({ items }: { items: ReadonlyArray<ReactNode> }) {
  const shown = items.filter((i) => i !== null && i !== false && i !== '');
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-dense text-muted">
      {shown.map((i, n) => (
        <span key={n} className="inline-flex items-center gap-2">
          {n > 0 ? <span aria-hidden className="text-faint">·</span> : null}
          {i}
        </span>
      ))}
    </div>
  );
}
