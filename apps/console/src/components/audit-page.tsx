'use client';

import { useQuery } from '@tanstack/react-query';
import { AUDIT_CATEGORIES, AUDIT_PAGE_SIZE, type AuditCategory, type AuditEntry } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useState } from 'react';
import { formatDayClock } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { countText } from '@/lib/plural';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { useLinkedFilters } from '@/lib/url-state';
import { CopyLinkButton } from './copy-link';
import { Button, cx, EmptyState, NeedLogin, PageHeader, QueryError, SkeletonBlock } from './ui';

const CATEGORY_KEY = {
  money: 'console.audit.cat_money',
  approvals: 'console.audit.cat_approvals',
  pauses: 'console.audit.cat_pauses',
  safety: 'console.audit.cat_safety',
  orders: 'console.audit.cat_orders',
  settings: 'console.audit.cat_settings',
} as const satisfies Record<AuditCategory, string>;
const LINK_DEFAULTS = { cat: '' };
const LINK_ALLOWED = { cat: AUDIT_CATEGORIES };

/**
 * v10 / p2 «سجلّ الشغل»: every Console action (who, when, what changed), newest first, 50 rows at a
 * time, narrowed by a chip, with how many rows the chip holds. Read only.
 */
export function AuditPage() {
  const signedIn = useSignedIn();
  return (
    <div className="mx-auto max-w-[980px]">
      <PageHeader title={t('console.audit.title')} subtitle={t('console.audit.subtitle')} />
      {!signedIn ? <NeedLogin /> : <Audit />}
    </div>
  );
}

function Audit() {
  const [category, setCategory] = useState<AuditCategory | null>(null);
  // Each "show older" adds the cursor of the page before it; a new chip starts again from the top.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const pick = (c: AuditCategory | null) => {
    setCategory(c);
    setCursors([undefined]);
  };
  useLinkedFilters({ cat: category ?? '' }, LINK_DEFAULTS, (got) => got['cat'] && pick(got['cat'] as AuditCategory), LINK_ALLOWED);
  const chip = (active: boolean) =>
    cx(
      'inline-flex h-9 items-center rounded-pill border px-3.5 text-xs font-medium transition-colors',
      active ? 'border-accent bg-accent-wash text-text' : 'border-line bg-surface text-muted hover:text-text',
    );
  return (
    <section className="rounded-lg border border-line bg-surface shadow-card" data-testid="audit">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3" role="group" aria-label={t('console.audit.filter')}>
        <button type="button" className={chip(category === null)} aria-pressed={category === null} onClick={() => pick(null)}>
          {t('console.audit.cat_all')}
        </button>
        {AUDIT_CATEGORIES.map((c) => (
          <button key={c} type="button" className={chip(category === c)} aria-pressed={category === c} onClick={() => pick(category === c ? null : c)}>
            {t(CATEGORY_KEY[c])}
          </button>
        ))}
        <span className="ms-auto">
          <CopyLinkButton />
        </span>
      </div>
      <ul className="divide-y divide-line">
        {cursors.map((cursor, i) => (
          <Chunk
            key={`${category ?? 'all'}:${cursor ?? 'top'}`}
            category={category}
            cursor={cursor}
            first={i === 0}
            last={i === cursors.length - 1}
            onMore={(next) => setCursors((prev) => [...prev, next])}
          />
        ))}
      </ul>
    </section>
  );
}

function Chunk({
  category,
  cursor,
  first,
  last,
  onMore,
}: {
  category: AuditCategory | null;
  cursor: string | undefined;
  first: boolean;
  last: boolean;
  onMore: (cursor: string) => void;
}) {
  const trpc = useTRPC();
  const page = useQuery(
    trpc.ops.controls.auditPage.queryOptions(
      { cityId: CITY_ID, limit: AUDIT_PAGE_SIZE, ...(category ? { category } : {}), ...(cursor ? { cursor } : {}) },
      { retry: queryRetry, staleTime: 5_000 },
    ),
  );
  if (page.isPending) {
    return (
      <li className="space-y-2 p-5">
        <SkeletonBlock className="h-10" />
        <SkeletonBlock className="h-10" />
        <SkeletonBlock className="h-10" />
      </li>
    );
  }
  if (page.isError) {
    return (
      <li className="p-5">
        <QueryError error={page.error} onRetry={() => void page.refetch()} />
      </li>
    );
  }
  const { rows, total, nextCursor } = page.data;
  return (
    <>
      {first ? (
        <li className="px-5 py-2.5 text-dense text-muted" data-testid="audit-count">
          {countText('console.audit.rows', total)}
        </li>
      ) : null}
      {first && rows.length === 0 ? (
        <li>
          <EmptyState bare title={t('console.audit.empty')} hint={t('console.audit.empty_hint')} />
        </li>
      ) : null}
      {rows.map((r) => (
        <Row key={r.id} row={r} />
      ))}
      {last && nextCursor ? (
        <li className="flex justify-center px-5 py-3">
          <Button variant="secondary" size="sm" onClick={() => onMore(nextCursor)}>
            {t('console.audit.older')}
          </Button>
        </li>
      ) : null}
    </>
  );
}

function Row({ row }: { row: AuditEntry }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3" data-testid="audit-row">
      <span className="num w-[104px] shrink-0 text-dense text-muted">{formatDayClock(row.at)}</span>
      <span className="shrink-0 truncate text-sm font-medium text-text sm:w-[88px]">
        {row.actorName ?? t('console.oncall_no_name')}
      </span>
      <span className="min-w-0 basis-full text-sm text-text sm:basis-0 sm:flex-1">{row.summary_ar}</span>
    </li>
  );
}
