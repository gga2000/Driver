'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ON_CALL_READ_ROLES, type InboxRow } from '@driver/contracts';
import { t } from '@driver/i18n';
import { formatClock, formatMoney } from '@/lib/format';
import { glanceVerdict, type GlanceTone } from '@/lib/glance';
import { detailText, KIND_KEY, rowHref, rowTone } from '@/lib/inbox';
import { CITY_ID, queryRetry, useRightNow } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { ageText } from '@/lib/safety';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import {
  buttonCls,
  Chip,
  cx,
  IconAlert,
  IconCheckCircle,
  IconClock,
  LiveBadge,
  NeedLogin,
  PageHeader,
  QueryError,
  SkeletonBlock,
  Stat,
  useNow,
} from './ui';

/** Same freshness as Today: the night check reads the same numbers the desk sees. */
const GLANCE_POLL_MS = 3_000;
/** The few most urgent open problems; the full list lives on Today. */
const GLANCE_ROWS = 5;

const VERDICT_CLS: Record<GlanceTone, string> = {
  ok: 'border-ok/30 bg-ok-tint text-ok',
  warn: 'border-warn/40 bg-warn-tint text-warn',
  bad: 'border-bad/40 bg-bad-tint text-bad',
};

/**
 * h8 «اليوم بنظرة»: today on one phone screen, read only, so Ali can check the city from bed. The
 * worst thing first in one line, six numbers, who holds SOS, and the most urgent open problems; nothing
 * here changes anything (Today does the work).
 */
export function GlancePage() {
  const signedIn = useSignedIn();
  return (
    <div className="mx-auto max-w-[440px]">
      <PageHeader title={t('console.glance.title')} subtitle={t('console.glance.subtitle')} />
      {!signedIn ? <NeedLogin /> : <Glance />}
    </div>
  );
}

function Glance() {
  const trpc = useTRPC();
  const { roles, loaded } = useMyRoles();
  const seesRoster = loaded && hasAny(roles, ON_CALL_READ_ROLES);
  const counts = useQuery(
    trpc.inbox.counts.queryOptions({ cityId: CITY_ID }, { retry: queryRetry, refetchInterval: GLANCE_POLL_MS }),
  );
  const list = useQuery(
    trpc.inbox.list.queryOptions(
      { cityId: CITY_ID, view: 'open' },
      { retry: queryRetry, refetchInterval: GLANCE_POLL_MS, placeholderData: (prev) => prev },
    ),
  );
  const onCall = useQuery(
    trpc.onCall.now.queryOptions({ cityId: CITY_ID }, { enabled: seesRoster, retry: queryRetry, refetchInterval: 60_000 }),
  );
  const right = useRightNow();
  const c = counts.data;
  const r = right.data;
  const sos = onCall.data?.find((d) => d.desk === 'sos');
  const verdict = glanceVerdict(c, r, sos);
  const failed = counts.isError && right.isError;
  const dash = '—';

  return (
    <div className="space-y-4" data-testid="glance">
      {failed ? (
        <QueryError error={counts.error} onRetry={() => void Promise.all([counts.refetch(), right.refetch()])} />
      ) : verdict ? (
        <section
          role="status"
          className={cx('flex items-start gap-3 rounded-lg border px-4 py-3.5', VERDICT_CLS[verdict.tone])}
          data-testid="glance-verdict"
          data-tone={verdict.tone}
        >
          {verdict.tone === 'ok' ? (
            <IconCheckCircle size={22} className="mt-0.5 shrink-0" />
          ) : (
            <IconAlert size={22} className="mt-0.5 shrink-0" />
          )}
          <p className="min-w-0 flex-1 text-base font-semibold leading-7">{t(verdict.key, { n: verdict.n })}</p>
        </section>
      ) : (
        <SkeletonBlock className="h-[60px]" />
      )}

      <div className="flex justify-end">
        <LiveBadge
          seconds={GLANCE_POLL_MS / 1000}
          updatedAt={counts.dataUpdatedAt || undefined}
          fetching={counts.isFetching}
          error={counts.isError}
        />
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <Stat
          label={t('console.today.stat_open')}
          value={c?.open ?? dash}
          tone={c && (c.byKind.sos ?? 0) > 0 ? 'bad' : c && c.open > 0 ? 'warn' : 'default'}
          hint={c ? t('console.today.stat_unassigned', { n: c.unassigned }) : undefined}
        />
        <Stat
          label={t('console.today.stat_late')}
          value={r?.lateOrders ?? dash}
          tone={r && r.lateOrders > 0 ? 'warn' : 'default'}
        />
        <Stat
          label={t('console.today.stat_active')}
          value={r?.activeOrders ?? dash}
          hint={r ? t('console.today.stat_last_hour', { n: r.ordersLastHour }) : undefined}
        />
        <Stat label={t('console.today.stat_drivers')} value={r?.activeDrivers ?? dash} />
        <Stat
          label={t('console.today.stat_done')}
          value={c?.doneToday ?? dash}
          tone={c && c.doneToday > 0 ? 'ok' : 'default'}
        />
        <Stat
          label={t('console.glance.cash_field')}
          value={<span className="text-[20px]">{r ? formatMoney(r.cashInFieldIqd) : dash}</span>}
        />
      </dl>

      {/* Nobody on SOS is already the red line on top unless an open SOS took that place. */}
      {sos && (sos.people[0] || verdict?.key !== 'console.glance.verdict_nobody_sos') ? (
        <p
          className={cx(
            'flex items-center gap-2 rounded-lg px-4 py-3 text-sm',
            sos.people[0] ? 'bg-surface-3 text-text' : 'bg-bad-tint font-medium text-bad',
          )}
          data-testid="glance-sos"
        >
          <IconClock size={16} className="shrink-0" />
          {sos.people[0]
            ? t('console.glance.sos_holder', {
                name: sos.people[0].displayName ?? t('console.oncall_no_name'),
                time: formatClock(sos.people[0].until),
              })
            : t('console.oncall_chip_nobody')}
        </p>
      ) : null}

      <section className="rounded-lg border border-line bg-surface shadow-card">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-text">
          {t('console.glance.top')}
        </h2>
        <TopRows rows={list.data} loading={list.isPending} />
      </section>

      <Link href="/" className={cx(buttonCls('secondary', 'md'), 'w-full justify-center')}>
        {t('console.glance.open_today')}
      </Link>
    </div>
  );
}

function TopRows({
  rows,
  loading,
}: {
  rows: InboxRow[] | undefined;
  loading: boolean;
}) {
  const now = useNow(15_000);
  if (loading && !rows) {
    return (
      <div className="space-y-2 p-4">
        <SkeletonBlock className="h-10" />
        <SkeletonBlock className="h-10" />
      </div>
    );
  }
  if (!rows || rows.length === 0) {
    return <p className="px-4 py-5 text-sm text-muted">{t('console.glance.none_open')}</p>;
  }
  // Today's own order: the server sorts the worst first.
  const top = rows.slice(0, GLANCE_ROWS);
  return (
    <ul className="divide-y divide-line">
      {top.map((row) => (
        <li key={row.id}>
          <Link
            href={rowHref(row)}
            className="flex min-h-[52px] flex-col justify-center gap-1 px-4 py-2.5 hover:bg-surface-2"
            data-testid="glance-row"
          >
            <span className="flex flex-wrap items-center gap-2">
              <Chip tone={rowTone(row)} dot>
                {t(KIND_KEY[row.kind])}
              </Chip>
              <span className="num text-dense text-muted">{ageText(now - row.openedAt.getTime())}</span>
            </span>
            <span className="truncate text-sm text-text">{detailText(row) || t(KIND_KEY[row.kind])}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
