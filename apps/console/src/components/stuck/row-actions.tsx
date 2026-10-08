'use client';

import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { t } from '@driver/i18n';
import { useState } from 'react';
import { CITY_ID } from '@/lib/live';
import { useMyRoles } from '@/lib/me';
import { useSignedIn } from '@/lib/session';
import { ACTION_KEY, actionsFor, type StaffAction } from '@/lib/staff-actions';
import { useTRPC } from '@/lib/trpc';
import { Button } from '../ui';

const StaffActionDialog = dynamic(() => import('./action-dialog').then((m) => m.StaffActionDialog), { ssr: false });

/**
 * Concept C: a stuck-order row on Today that you hold opens its way-outs in place, so ending it is
 * one dialog away. The row closes itself when the order stops being stuck (`order.unstuck`). Shares
 * the order page's `orders.ops.stuck` read (one cached list for the whole page).
 */
export function StuckRowActions({ orderId }: { orderId: string }) {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const { roles } = useMyRoles();
  const stuck = useQuery(trpc.orders.ops.stuck.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, retry: false, refetchInterval: 30_000 }));
  const order = stuck.data?.find((s) => s.orderId === orderId);
  const switches = useQuery(trpc.orders.ops.switches.queryOptions(undefined, { enabled: signedIn, retry: false, staleTime: 60_000 }));
  const [open, setOpen] = useState<StaffAction | null>(null);
  const actions = order ? actionsFor(order, roles) : [];
  if (!order || actions.length === 0) return null;
  return (
    <div className="flex w-full flex-wrap items-center gap-2 border-t border-line pt-3" role="group" aria-label={t('console.stuck.ways')} data-testid="stuck-row-actions">
      <span className="me-1 text-dense text-muted">{t('console.stuck.ways')}</span>
      {actions.map((a, i) => (
        <Button key={a} size="sm" variant={i === 0 ? 'primary' : a === 'cancel' || a === 'courierLost' ? 'danger-soft' : 'secondary'} onClick={() => setOpen(a)} needsNet>
          {t(ACTION_KEY[a])}
        </Button>
      ))}
      {open ? <StaffActionDialog order={order} action={open} switches={switches.data ?? null} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
