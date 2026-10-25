'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { CustomerProfile as Profile } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useState } from 'react';
import { formatIqd } from '@/lib/format';
import { orderTypeLabel } from '@/lib/labels';
import { CITY_ID, queryRetry } from '@/lib/live';
import { useNames } from '@/lib/names';
import { everyText, versus } from '@/lib/people';
import { dayMonth, stamp } from '@/lib/periods';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { CopyLinkButton } from '../copy-link';
import { NewTicketDialog } from '../support/new-ticket';
import { Avatar, Button, Card, Chip, NeedLogin, QueryError, Skeleton, Stat, StatStrip, Tabs, useNow } from '../ui';
import { Bars, HourStrip, ShareBars } from './charts';
import { Block, Facts, NowBar, RecentOrders, SegmentChip, Signals, TicketList } from './bits';
import { RevealPhone } from './reveal-phone';
import { Story } from './story';

type Tab = 'overview' | 'story' | 'support';

/**
 * One customer, whole (Ali 2026-10-21, «mix of all ideas»): who they are with the number masked,
 * what's happening now, the few things worth knowing, four numbers against the city, then the
 * charts, «القصة» (everything in order) and their tickets.
 */
export function CustomerProfile({ personId }: { personId: string }) {
  const signedIn = useSignedIn();
  const trpc = useTRPC();
  const p = useQuery(trpc.people.customer.queryOptions({ cityId: CITY_ID, personId }, { enabled: signedIn, retry: queryRetry, refetchInterval: 30_000 }));
  const [tab, setTab] = useState<Tab>('overview');
  const [ticket, setTicket] = useState(false);
  const now = new Date(useNow(60_000));
  const d = p.data;

  const back = (
    <Link href="/customers" className="text-muted hover:text-accent-text hover:underline">
      {t('console.ppl_customers_title')}
    </Link>
  );
  if (!signedIn) return <NeedLogin />;
  if (p.error) {
    return (
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-3 text-dense">{back}</div>
        <QueryError error={p.error} onRetry={() => void p.refetch()} />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-3 text-dense">{back}</div>
      <header className="mb-5 flex flex-wrap items-start gap-4">
        <Avatar id={personId} name={d?.name} size="lg" className="!h-14 !w-14 !text-2xl" />
        <div className="min-w-0 flex-1 basis-56">
          {d ? (
            <>
              <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold leading-9">
                <span className="truncate">{d.name ?? t('console.ppl_no_name')}</span>
                <SegmentChip segment={d.segment} size="md" />
              </h1>
              <Facts
                items={[
                  <RevealPhone key="p" personId={personId} masked={d.phoneMasked} />,
                  t('console.ppl_since', { date: dayMonth(d.joinedAt, now) }),
                  d.lastActiveAt ? t('console.ppl_last_active', { when: stamp(d.lastActiveAt, now) }) : null,
                ]}
              />
            </>
          ) : (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-8 w-56" />
              <Skeleton className="h-4 w-80" />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
          <Button variant="primary" onClick={() => setTicket(true)}>
            {t('console.ppl_open_ticket')}
          </Button>
          <CopyLinkButton />
        </div>
      </header>

      {d ? (
        <>
          <NowBar live={d.live} />
          {d.signals.length > 0 ? (
            <Card className="mb-5" title={t('console.ppl_summary')}>
              <Signals signals={d.signals} />
            </Card>
          ) : null}
          <KeyNumbers d={d} />
          <Tabs
            label={t('console.ppl_tabs')}
            value={tab}
            onChange={setTab}
            className="mb-5"
            options={[
              { value: 'overview', label: t('console.ppl_tab_overview') },
              { value: 'story', label: t('console.ppl_tab_story') },
              { value: 'support', label: t('console.ppl_tab_support'), ...(d.tickets.open > 0 ? { count: d.tickets.open } : {}) },
            ]}
          />
          {tab === 'overview' ? <Overview d={d} /> : tab === 'story' ? <Story personId={personId} who="customer" /> : <Support d={d} />}
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}
      <NewTicketDialog open={ticket} onClose={() => setTicket(false)} customerId={personId} />
    </div>
  );
}

function KeyNumbers({ d }: { d: Profile }) {
  const vsCity = versus(d.totals.avgOrderIqd, d.totals.cityAvgOrderIqd);
  return (
    <StatStrip money className="mb-5">
      <Stat label={t('console.ppl_stat_orders')} value={d.totals.orders} hint={t('console.ppl_stat_orders_hint', { delivered: d.totals.delivered, cancelled: d.totals.cancelled })} />
      <Stat
        label={t('console.ppl_stat_avg')}
        value={d.totals.avgOrderIqd !== null ? `${formatIqd(d.totals.avgOrderIqd)} ${t('quote.currency')}` : '—'}
        {...(vsCity !== null ? { delta: { value: vsCity, text: t('console.ppl_vs_city', { pct: Math.abs(vsCity) }), goodWhen: 'up' as const } } : {})}
      />
      <Stat
        label={t('console.ppl_stat_every')}
        value={d.totals.everyDays !== null ? everyText(d.totals.everyDays) : '—'}
        hint={d.totals.everyDays === null ? t('console.ppl_every_few') : undefined}
      />
      <Stat label={t('console.ppl_stat_spent')} value={`${formatIqd(d.totals.spentIqd)} ${t('quote.currency')}`} {...(d.totals.rides > 0 ? { hint: t('console.ppl_stat_rides', { n: d.totals.rides }) } : {})} />
    </StatStrip>
  );
}

function Overview({ d }: { d: Profile }) {
  const names = useNames({ orgs: d.topMerchants.map((m) => m.orgId) });
  const weeks = d.weekly;
  const last = weeks.length - 1;
  const top = Math.max(...weeks, 0);
  const payTotal = d.payment.cash + d.payment.wallet + d.payment.other;
  const pct = (n: number) => (payTotal > 0 ? `${Math.round((n / payTotal) * 100)}%` : '—');
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title={t('console.ppl_chart_weekly')} className="lg:col-span-2">
        <Bars
          values={weeks}
          tips={weeks.map((n, i) => t('console.ppl_week_tip', { when: i === last ? t('console.ppl_this_week') : t('console.ppl_weeks_ago', { n: last - i }), n }))}
          label={t('console.ppl_chart_weekly_aria', { now: weeks[last] ?? 0, top })}
          partialLast
          axis={
            <>
              <span>{t('console.ppl_weeks_ago', { n: last })}</span>
              <span>{t('console.ppl_this_week')}</span>
            </>
          }
        />
      </Card>
      <Card title={t('console.ppl_chart_hours')} className="lg:col-span-2">
        <HourStrip hours={d.hours} label={t('console.ppl_chart_hours')} />
      </Card>
      <Card title={t('console.ppl_chart_services')}>
        {d.services.length ? (
          <ShareBars label={t('console.ppl_chart_services')} items={d.services.map((s) => ({ key: s.type, label: orderTypeLabel(s.type), value: s.count }))} />
        ) : (
          <p className="text-dense text-muted">{t('console.ppl_recent_none')}</p>
        )}
        <div className="mt-5">
          <Block title={t('console.ppl_chart_payment')}>
            <ShareBars
              label={t('console.ppl_chart_payment')}
              items={[
                { key: 'cash', label: t('console.ppl_pay_cash'), value: d.payment.cash, text: pct(d.payment.cash) },
                { key: 'wallet', label: t('console.ppl_pay_wallet'), value: d.payment.wallet, text: pct(d.payment.wallet) },
                ...(d.payment.other > 0 ? [{ key: 'other', label: t('console.ppl_pay_other'), value: d.payment.other, text: pct(d.payment.other) }] : []),
              ]}
            />
          </Block>
        </div>
      </Card>
      <Card title={t('console.ppl_chart_merchants')}>
        {d.topMerchants.length ? (
          <ShareBars label={t('console.ppl_chart_merchants')} items={d.topMerchants.map((m) => ({ key: m.orgId, label: names.org(m.orgId)?.name ?? '…', value: m.count }))} />
        ) : (
          <p className="text-dense text-muted">{t('console.ppl_recent_none')}</p>
        )}
      </Card>
      <Card title={t('console.ppl_recent')} className="lg:col-span-2" hint={t('console.ppl_recent_hint')}>
        <RecentOrders orders={d.recent} customerId={d.personId} />
      </Card>
    </div>
  );
}

function Support({ d }: { d: Profile }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card title={t('console.ppl_tickets')} hint={t('console.ppl_tickets_hint', { total: d.tickets.total, open: d.tickets.open })}>
        <TicketList tickets={d.tickets.recent} empty={t('console.ppl_tickets_none')} />
      </Card>
      <div className="space-y-5">
        <Card title={t('console.ppl_credits30')}>
          <p className="num text-xl font-semibold">
            {formatIqd(d.credits30dIqd)} <span className="text-sm font-normal text-muted">{t('quote.currency')}</span>
          </p>
          <p className="mt-1 text-xs text-faint">{t('console.ppl_credits30_hint')}</p>
        </Card>
        <Card title={t('console.ppl_rating_given')}>
          {d.ratingAvg !== null ? (
            <p className="text-sm">
              <span className="num text-xl font-semibold">{d.ratingAvg.toFixed(1)}</span> <span className="text-muted">{t('console.ppl_rating_of', { n: d.ratingCount })}</span>
            </p>
          ) : (
            <p className="text-dense text-muted">{t('console.ppl_rating_none')}</p>
          )}
        </Card>
        {d.frozen ? (
          <Card tone="bad" title={t('console.ppl_frozen_title')}>
            <Chip tone="bad">{t('console.ppl_seg_frozen')}</Chip>
            <p className="mt-2 text-dense text-muted">{t('console.ppl_frozen_hint')}</p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
