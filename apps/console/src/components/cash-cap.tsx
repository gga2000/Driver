'use client';

import { t, type MessageKey } from '@driver/i18n';
import { CASH_LEVEL_CLS, cashLevel } from '@/lib/control-room';
import { formatIqd } from '@/lib/format';
import { capFill } from '@/lib/roster';
import { cx, IconAlert } from './ui';

/**
 * Cash against the cap as the money spec draws it (and /finance does): a thin bar with ticks where
 * amber (70 %) and red (90 %) start, and the level in words beside it from amber up, so colour is
 * never alone. `compact` is the table cell ("600 من 75,000"); the full one is the ledger's hero.
 */
export function CashCapBar({ owedIqd, capIqd, overCap, label, compact = false }: { owedIqd: number; capIqd: number; overCap: boolean; label: string; compact?: boolean }) {
  const fill = capFill({ owedIqd, capIqd });
  const level = cashLevel(fill, overCap);
  const pct = Math.round(fill * 100);
  const words = t(`console.fin_level_${level}` as MessageKey);
  const owed = Math.max(0, owedIqd);
  return (
    <span className={cx('block', compact ? 'w-[10rem]' : 'w-full')}>
      <span className={cx('flex items-baseline justify-between gap-2', compact ? 'text-xs' : 'text-sm')}>
        <span className="num whitespace-nowrap">
          <span className={cx('font-medium', owed === 0 ? 'text-muted' : 'text-text')}>{formatIqd(owed)}</span>
          <span className="text-muted"> {t('console.cap_of', { cap: formatIqd(capIqd) })}</span>
        </span>
        {level !== 'ok' ? (
          <span className={cx('inline-flex items-center gap-1 whitespace-nowrap font-semibold', CASH_LEVEL_CLS[level].text)}>
            {level !== 'near' ? <IconAlert size={12} /> : null}
            {compact ? `${pct}%` : words}
          </span>
        ) : !compact ? (
          <span className="whitespace-nowrap text-muted">{words}</span>
        ) : null}
      </span>
      <span
        role="meter"
        aria-valuemin={0}
        aria-valuemax={capIqd}
        aria-valuenow={owed}
        aria-valuetext={`${words} · ${pct}%`}
        aria-label={label}
        className={cx('relative mt-1 block overflow-hidden rounded-pill bg-surface-3', compact ? 'h-1.5' : 'h-2.5')}
      >
        <span className={cx('absolute inset-y-0 start-0 rounded-pill', CASH_LEVEL_CLS[level].bar)} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        {/* 70 % and 90 %: where amber and red start (money spec §4). */}
        <span aria-hidden className="absolute inset-y-0 start-[70%] w-px bg-surface" />
        <span aria-hidden className="absolute inset-y-0 start-[90%] w-px bg-surface" />
      </span>
    </span>
  );
}
