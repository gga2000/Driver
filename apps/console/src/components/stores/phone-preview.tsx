'use client';

import { useQuery } from '@tanstack/react-query';
import { t } from '@driver/i18n';
import { fileUrl } from '@/lib/control-room';
import { formatMoney } from '@/lib/format';
import { queryRetry } from '@/lib/live';
import { API_URL, useTRPC } from '@/lib/trpc';
import { cx, Skeleton } from '../ui';

/**
 * «مثل ما يشوفه الزبون» (concept A): the store as a customer's phone shows it — the shop's photo and
 * name, open or not, each section with its dishes, photos and prices. It follows every save, so the
 * team sees what a change looks like before leaving the shop. A sketch of the app, not the app itself.
 */
export function PhonePreview({ storeId }: { storeId: string }) {
  const trpc = useTRPC();
  const scope = { merchantOrgId: storeId };
  const menu = useQuery(trpc.ops.stores.menu.queryOptions(scope, { retry: queryRetry }));
  const setup = useQuery(trpc.ops.stores.setup.queryOptions(scope, { retry: queryRetry }));
  const status = useQuery(trpc.ops.stores.status.queryOptions(scope, { retry: queryRetry }));
  const photo = setup.data?.shopPhotoUrl ?? null;
  const live = setup.data ? !setup.data.active || setup.data.live : true;
  return (
    <div className="sticky top-4">
      <p className="mb-2 text-xs text-muted">{t('console.stores.preview')}</p>
      <div className="mx-auto w-[280px] rounded-[28px] border-[6px] border-text/85 bg-bg shadow-overlay" data-testid="phone-preview">
        <div className="h-[560px] overflow-y-auto rounded-[22px] bg-bg [scrollbar-width:thin]">
          <div className="relative h-32 bg-surface-3">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- API media
              <img src={fileUrl(photo, API_URL)} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full items-center justify-center text-xs text-muted">{t('console.stores.shop_photo_none')}</span>
            )}
          </div>
          <div className="px-3 pb-2 pt-3">
            <p className="text-base font-semibold text-text">{status.data?.name ?? ''}</p>
            <p className={cx('mt-0.5 text-xs', !live ? 'text-muted' : status.data?.open ? 'text-ok' : 'text-warn')}>
              {!live ? t('console.stores.preview_hidden') : status.data?.open ? t('console.stores.now_open') : t('console.stores.now_closed')}
            </p>
          </div>
          {!menu.data ? (
            <div className="space-y-2 px-3" aria-busy>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 rounded-md" />
              ))}
            </div>
          ) : menu.data.categories.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted">{t('console.stores.menu_empty')}</p>
          ) : (
            menu.data.categories.map((c) => (
              <section key={c.nameAr ?? ''} className="px-3 pb-3">
                <h4 className="sticky top-0 bg-bg py-1.5 text-sm font-semibold text-text">{c.nameAr ?? t('console.stores.section_none')}</h4>
                <ul className="space-y-2">
                  {c.items.map((i) => (
                    <li key={i.id} className={cx('flex items-center gap-2 rounded-md bg-surface p-2 shadow-card', !i.onSale && 'opacity-55')}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-text">{i.nameAr}</span>
                        <span className="num block text-xs text-muted">{formatMoney(i.priceIqd)}</span>
                        {!i.onSale ? <span className="block text-[11px] text-warn">{t('console.stores.sold_out')}</span> : null}
                      </span>
                      <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-surface-3">
                        {i.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- API media
                          <img src={fileUrl(i.photoUrl, API_URL)} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : null}
                        {i.photoLibrary ? <span className="absolute inset-x-0 bottom-0 bg-surface/85 text-center text-[9px] leading-3 text-muted">{t('console.stores.library_tag')}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
