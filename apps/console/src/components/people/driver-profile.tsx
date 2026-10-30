'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { DriverPeopleProfile as Profile } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useState } from 'react';
import { formatIqd } from '@/lib/format';
import { capRoleLabel, capTierLabel, pinStateLabel, vehicleLabel, zoneName } from '@/lib/labels';
import { CITY_ID, queryRetry } from '@/lib/live';
import { markerStateForPin } from '@/lib/live-map';
import { versus } from '@/lib/people';
import { dayMonth, stamp } from '@/lib/periods';
import { countText } from '@/lib/plural';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { CashCapBar } from '../cash-cap';
import { CopyLinkButton } from '../copy-link';
import { DriverPause } from '../driver-pause';
import { StateGlyph } from '../map-cards';
import { OrderRef } from '../named';
import { Avatar, buttonCls, Card, Chip, cx, NeedLogin, QueryError, Skeleton, Stat, StatStrip, Tabs, useNow, type ChipTone } from '../ui';
import { Bars, WeekHeat } from './charts';
import { Facts, TicketList } from './bits';
import { RevealPhone } from './reveal-phone';
import { Story } from './story';

type Tab = 'overview' | 'story' | 'complaints';

const DOC_TONE: Record<string, ChipTone> = { approved: 'done', pending: 'warn', rejected: 'bad', expiring: 'warn', expired: 'bad' };

/**
 * One courier or driver, whole (every service: دليفري, تكسي/تكتك, الرجعة, خطوط): where he is now,
 * his score and tier, the week against last week, 14 days of earnings, when he works, cash in hand
 * against the cap, papers, ratings and complaints, and «القصة». His money book stays one link away.
 */
export function DriverProfile({ personId }: { personId: string }) {
  const signedIn = useSignedIn();
  const trpc = useTRPC();
  const p = useQuery(trpc.people.driver.queryOptions({ cityId: CITY_ID, personId }, { enabled: signedIn, retry: queryRetry, refetchInterval: 30_000 }));
  const [tab, setTab] = useState<Tab>('overview');
  const now = new Date(useNow(30_000));
  const d = p.data;

  const back = (
    <Link href="/drivers" className="text-muted hover:text-accent-text hover:underline">
      {t('console.drivers_title')}
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
                {d.roles.map((r) => (
                  <Chip key={r} tone="accent">
                    {capRoleLabel(r)}
                  </Chip>
                ))}
                {d.frozen ? <Chip tone="bad">{t('console.driver_frozen')}</Chip> : null}
              </h1>
              <Facts
                items={[
                  <RevealPhone key="p" personId={personId} masked={d.phoneMasked} />,
                  d.vehicle ? [vehicleLabel(d.vehicle.vehicleClass), d.vehicle.plate].filter(Boolean).join(' · ') : null,
                  t('console.ppl_driver_since', { date: dayMonth(d.joinedAt, now) }),
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
          <Link href={`/drivers/${encodeURIComponent(personId)}/ledger`} className={buttonCls('secondary')}>
            {t('console.ppl_ledger')}
          </Link>
          <DriverPause personId={personId} />
          <CopyLinkButton />
        </div>
      </header>

      {d ? (
        <>
          <LiveLine d={d} now={now} />
          <KeyNumbers d={d} />
          <Tabs
            label={t('console.ppl_tabs')}
            value={tab}
            onChange={setTab}
            className="mb-5"
            options={[
              { value: 'overview', label: t('console.ppl_tab_overview') },
              { value: 'story', label: t('console.ppl_tab_story') },
              { value: 'complaints', label: t('console.ppl_tab_complaints'), ...(d.complaints.total > 0 ? { count: d.complaints.total } : {}) },
            ]}
          />
          {tab === 'overview' ? (
            <Overview d={d} now={now} />
          ) : tab === 'story' ? (
            <Story personId={personId} who="driver" />
          ) : (
            <Card title={t('console.ppl_tab_complaints')} hint={t('console.ppl_complaints_hint')}>
              <TicketList tickets={d.complaints.recent} empty={t('console.ppl_complaints_none')} fault />
            </Card>
          )}
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}
    </div>
  );
}

/** «هسة»: online state and zone, or when he was last seen; papers that keep him offline in red. */
function LiveLine({ d, now }: { d: Profile; now: Date }) {
  const state = d.live ? markerStateForPin(d.live.state) : 'offline';
  return (
    <section
      aria-label={t('console.ppl_now')}
      className={cx(
        'mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border px-4 py-3 text-sm',
        d.live ? 'border-accent/40 bg-accent-wash' : 'border-line bg-surface',
      )}
    >
      <span className="inline-flex items-center gap-2 font-semibold">
        <StateGlyph state={state} size={16} />
        {d.live ? pinStateLabel(d.live.state) : t('console.presence_offline')}
      </span>
      {d.live?.zoneId ? <span>{zoneName(d.live.zoneId)}</span> : null}
      {d.live?.tripId ? <OrderRef id={d.live.tripId} copy={false} /> : null}
      {!d.live && d.lastActiveAt ? <span className="text-muted">{t('console.ppl_last_seen', { when: stamp(d.lastActiveAt, now) })}</span> : null}
      {d.docs.blocksOnline ? (
        <Chip tone="bad" className="ms-auto">
          {t('console.ppl_docs_block')}
        </Chip>
      ) : null}
    </section>
  );
}

function KeyNumbers({ d }: { d: Profile }) {
  const net = versus(d.week.netIqd, d.lastWeek.netIqd);
  const jobs = versus(d.week.jobs, d.lastWeek.jobs);
  return (
    <StatStrip money className="mb-5">
      <Stat
        label={t('console.ppl_d_week_net')}
        value={`${formatIqd(d.week.netIqd)} ${t('quote.currency')}`}
        {...(net !== null ? { delta: { value: net, text: t('console.ppl_vs_last_week', { pct: Math.abs(net) }), goodWhen: 'up' as const } } : {})}
        {...(d.week.tipsIqd > 0 ? { hint: t('console.ppl_d_tips', { amount: formatIqd(d.week.tipsIqd) }) } : {})}
      />
      <Stat
        label={t('console.ppl_d_week_jobs')}
        value={d.week.jobs}
        {...(jobs !== null ? { delta: { value: jobs, text: t('console.ppl_vs_last_week', { pct: Math.abs(jobs) }), goodWhen: 'up' as const } } : {})}
      />
      <Stat
        label={t('console.driver_tier')}
        value={d.score.tier ? capTierLabel(d.score.tier) : '—'}
        tone="accent"
        hint={d.score.observation ? t('console.ppl_d_observation', { n: d.score.completedTrips }) : d.score.index !== null ? t('console.driver_score', { index: d.score.index }) : undefined}
      />
      <Stat label={t('console.ppl_d_rating')} value={d.ratings.avg !== null ? d.ratings.avg.toFixed(1) : '—'} hint={t('console.ppl_rating_of', { n: d.ratings.count })} />
    </StatStrip>
  );
}

function Overview({ d, now }: { d: Profile; now: Date }) {
  const nets = d.daily.map((x) => Math.max(0, x.netIqd));
  const best = Math.max(...nets, 0);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title={t('console.ppl_d_daily')} className="lg:col-span-2">
        <Bars
          values={nets}
          showValues={false}
          partialLast
          tips={d.daily.map((x) => t('console.ppl_day_tip', { day: dayMonth(x.day, now), amount: formatIqd(x.netIqd), jobs: countText('console.driver_jobs', x.jobs) }))}
          label={t('console.ppl_d_daily_aria', { best: formatIqd(best) })}
          axis={
            d.daily.length ? (
              <>
                <span>{dayMonth(d.daily[0]!.day, now)}</span>
                <span>{t('console.ppl_today')}</span>
              </>
            ) : undefined
          }
        />
      </Card>
      <Card title={t('console.ppl_d_heat')} className="lg:col-span-2" hint={t('console.ppl_d_heat_hint')}>
        <WeekHeat rows={d.heat} label={t('console.ppl_d_heat')} />
      </Card>
      <Card title={t('console.ppl_d_score')}>
        {d.score.metrics.length ? (
          <dl className="m-0 divide-y divide-line">
            {d.score.metrics.map((m) => (
              <div key={m.key} className="flex items-baseline justify-between gap-3 py-2">
                <dt className="text-dense text-muted">{m.label}</dt>
                <dd className="num m-0 font-semibold">{m.display}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-dense text-muted">{t('console.ppl_d_score_none')}</p>
        )}
      </Card>
      <div className="space-y-5">
        <Card title={t('console.ppl_d_cash')}>
          <CashCapBar owedIqd={d.cash.owedIqd} capIqd={d.cash.capIqd} overCap={d.cash.overCap} label={t('console.driver_cash_vs_cap')} />
        </Card>
        <Card title={t('console.ppl_d_docs')}>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {d.docs.documents.map((doc) => (
              <li key={doc.kind}>
                <Chip tone={DOC_TONE[doc.status] ?? 'neutral'} title={doc.expiresAt ? t('console.ppl_doc_until', { date: dayMonth(doc.expiresAt, now) }) : undefined}>
                  {t(`console.ppl_doc_${doc.kind}` as MessageKey)} · {t(`console.ppl_doc_st_${doc.status}` as MessageKey)}
                </Chip>
              </li>
            ))}
            {d.docs.missing.map((k) => (
              <li key={k}>
                <Chip tone="bad">
                  {t(`console.ppl_doc_${k}` as MessageKey)} · {t('console.ppl_doc_missing')}
                </Chip>
              </li>
            ))}
          </ul>
          {d.docs.documents.length === 0 && d.docs.missing.length === 0 ? <p className="text-dense text-muted">{t('console.ppl_d_docs_none')}</p> : null}
        </Card>
      </div>
      <Card title={t('console.ppl_d_ratings')} className="lg:col-span-2">
        {d.ratings.recent.length ? (
          <ul className="m-0 list-none divide-y divide-line p-0">
            {d.ratings.recent.map((r) => (
              <li key={r.orderId + r.at.toISOString()} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="min-w-[6rem]">
                  <Stars n={r.score} />
                </span>
                <OrderRef id={r.orderId} copy={false} />
                <span className="text-dense text-muted">{r.reasons.join(t('console.list_sep'))}</span>
                <span className="ms-auto text-xs text-faint">{stamp(r.at, now)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-dense text-muted">{t('console.ppl_rating_none')}</p>
        )}
      </Card>
    </div>
  );
}

/** Five marks, the score filled (a shape and a number, never colour alone). */
function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={String(n)}>
      <span aria-hidden className="inline-flex gap-0.5" dir="ltr">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={cx('h-2.5 w-2.5 rounded-pill', i <= n ? (n <= 2 ? 'bg-bad-solid' : 'bg-accent') : 'bg-surface-3')} />
        ))}
      </span>
      <span className="num text-dense">{n}</span>
    </span>
  );
}
