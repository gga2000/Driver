'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ZONE_TIER_ROLES } from '@driver/contracts';
import { t } from '@driver/i18n';
import { formatIqd } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { Button, Dialog, QueryError, Skeleton } from './ui';

/**
 * «شنو يتغير؟» (admin only): a read-only dry run for «الأسعار تتبع الحدود». Recent delivery pins are placed
 * by the built-in circles and by the drawn outlines; the dialog shows how many would move and what that
 * does to the delivery fee. It changes nothing and shows no pin or customer.
 */
export function ZonePinCheckPanel({ nameOf }: { nameOf: (key: string) => string }) {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const { roles } = useMyRoles();
  const [open, setOpen] = useState(false);
  const check = useQuery(trpc.ops.zones.pinCheck.queryOptions({ cityId: CITY_ID }, { enabled: signedIn && open, retry: queryRetry }));
  if (!hasAny(roles, ZONE_TIER_ROLES)) return null;
  const r = check.data;
  const signed = (n: number) => (n > 0 ? `+${formatIqd(n)}` : formatIqd(n));
  return (
    <>
      <Button variant="secondary" size="sm" className="fixed bottom-4 start-4 z-20 shadow" data-testid="zone-pin-check-open" onClick={() => setOpen(true)}>
        {t('console.zones_pincheck_open')}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('console.zones_pincheck_title')} footer={<Button variant="ghost" onClick={() => setOpen(false)}>{t('console.close')}</Button>}>
        <div className="space-y-3 text-sm" data-testid="zone-pin-check">
          <p className="text-muted">{t('console.zones_pincheck_hint')}</p>
          {check.isPending ? <Skeleton className="h-24" /> : null}
          {check.error ? <QueryError error={check.error} onRetry={() => void check.refetch()} /> : null}
          {r && r.pins === 0 ? <p>{t('console.zones_pincheck_none')}</p> : null}
          {r && r.pins > 0 ? (
            <>
              <p data-testid="zone-pin-check-summary">{t('console.zones_pincheck_summary', { changed: r.changed, pins: r.pins, zones: r.drawnZones })}</p>
              <p>{t('console.zones_pincheck_fees', { dearer: r.dearer, cheaper: r.cheaper, avg: signed(r.avgFeeChangeIqd) })}</p>
              {r.newlyServed > 0 ? <p>{t('console.zones_pincheck_newly', { count: r.newlyServed })}</p> : null}
              {r.moves.length > 0 ? (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {r.moves.map((m) => (
                    <li key={`${m.fromKey ?? ''}>${m.toKey}`} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span>{t('console.zones_pincheck_move', { from: m.fromKey ? nameOf(m.fromKey) : t('console.zones_pincheck_outside'), to: nameOf(m.toKey) })}</span>
                      <span className="num shrink-0 text-muted">{m.pins} · {m.feeChangeIqd === null ? '—' : signed(m.feeChangeIqd)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
