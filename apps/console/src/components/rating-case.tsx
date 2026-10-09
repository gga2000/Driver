'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { INBOX_RULES, type Order } from '@driver/contracts';
import { t } from '@driver/i18n';
import { badRating, ratingReasons } from '@/lib/rating-case';
import { OrgName, PersonName } from './named';
import { buttonCls, Chip, IconFlag } from './ui';

const RIDE_TYPES: ReadonlySet<string> = new Set(['ride', 'seat', 'subscription']);

/**
 * A bad rating (food or courier at 2 or under) is a case on Today (Ali, 2026-10-08): this strip on
 * the order says what the customer gave and why, in his words, and names the people to hear from
 * before the case is closed: the customer, the restaurant and the courier (or the driver on a ride).
 * Nothing shows for a good rating.
 */
export function RatingCase({ o, courierId }: { o: Order; courierId: string | null }) {
  const rating = o.rating;
  if (!rating || !badRating(rating)) return null;
  const ride = RIDE_TYPES.has(o.type);
  const reasons = ratingReasons(rating, ride);
  return (
    <section
      aria-labelledby="rating-case"
      data-testid="rating-case"
      className="mb-5 rounded-lg border border-warn-solid/50 bg-warn-tint"
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 pt-3">
        <IconFlag size={20} className="mt-0.5 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <h2 id="rating-case" className="font-semibold text-text">
            {t('console.rating_case_title')}
          </h2>
          <p className="text-dense text-muted">{t('console.rating_case_hint', { max: INBOX_RULES.lowRatingMaxStars })}</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 ps-9 sm:w-auto sm:ps-0">
          {rating.food !== null ? <Score label={t('console.rating_case_food')} n={rating.food} /> : null}
          {rating.delivery !== null ? (
            <Score label={t(ride ? 'console.rating_case_driver' : 'console.rating_case_courier')} n={rating.delivery} />
          ) : null}
        </div>
      </div>

      {reasons.length > 0 || rating.note ? (
        <div className="space-y-2 px-4 pt-3 sm:ps-[3.25rem]">
          {reasons.length > 0 ? (
            <ul aria-label={t('console.rating_case_reasons')} className="flex flex-wrap gap-1.5">
              {reasons.map((k) => (
                <li key={k}>
                  <Chip size="sm" tone="neutral">
                    {t(k)}
                  </Chip>
                </li>
              ))}
            </ul>
          ) : null}
          {rating.note ? (
            <blockquote className="max-w-[65ch] border-s-2 border-warn-solid/60 ps-3 text-sm leading-6 text-text">
              <span className="sr-only">{t('console.rating_case_said')}: </span>
              {rating.note}
            </blockquote>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 border-t border-warn-solid/30 px-4 py-3">
        <p className="mb-2 text-xs font-medium text-muted">{t('console.rating_case_hear')}</p>
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-3">
          <Party role={t('console.order_customer')}>
            <PersonName id={o.ordererId} copy={false} strong />
          </Party>
          {o.merchantOrgId ? (
            <Party
              role={t('console.order_merchant')}
              action={
                <Link href={`/stores/${encodeURIComponent(o.merchantOrgId)}`} className={buttonCls('ghost', 'sm')}>
                  {t('console.rating_case_open_store')}
                </Link>
              }
            >
              <OrgName id={o.merchantOrgId} copy={false} className="font-semibold" />
            </Party>
          ) : null}
          <Party
            role={ride ? t('console.order_driver') : t('console.order_courier')}
            action={
              courierId ? (
                <Link href={`/drivers/${encodeURIComponent(courierId)}/ledger`} className={buttonCls('ghost', 'sm')}>
                  {t('console.rating_case_open_driver')}
                </Link>
              ) : null
            }
          >
            {courierId ? (
              <PersonName id={courierId} copy={false} strong />
            ) : (
              <span className="text-muted">{ride ? t('console.order_no_driver') : t('console.order_no_courier')}</span>
            )}
          </Party>
        </ul>
      </div>
    </section>
  );
}

function Score({ label, n }: { label: string; n: number }) {
  return (
    <Chip tone={n <= INBOX_RULES.lowRatingMaxStars ? 'bad' : 'neutral'}>
      <span className="num">{t('console.rating_case_score', { label, n })}</span>
    </Chip>
  );
}

function Party({ role, children, action }: { role: string; children: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-md bg-surface px-3 py-1.5">
      <div className="min-w-0">
        <p className="text-xs text-muted">{role}</p>
        <p className="truncate text-sm">{children}</p>
      </div>
      {action ?? null}
    </li>
  );
}

