'use client';

import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import type { StuckOrder } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useState } from 'react';
import { STUCK_KEY } from '@/lib/inbox';
import { CITY_ID } from '@/lib/live';
import { useMyRoles } from '@/lib/me';
import { useSignedIn } from '@/lib/session';
import { ACTION_KEY, actionsFor, type StaffAction } from '@/lib/staff-actions';
import { compactDuration } from '@/lib/support-views';
import { useTRPC } from '@/lib/trpc';
import { Button, IconAlert } from '../ui';

const StaffActionDialog = dynamic(() => import('./action-dialog').then((m) => m.StaffActionDialog), { ssr: false });

/**
 * Concept A: when the server lists this order as stuck, a strip under the header says how long and
 * why, with the way-outs this person may use (the server's `StuckOrder.actions`, filtered by role).
 * Nothing shows for an order that isn't stuck.
 */
export function StuckStrip({ orderId }: { orderId: string }) {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const { roles, loaded } = useMyRoles();
  const stuck = useQuery(trpc.orders.ops.stuck.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, retry: false, refetchInterval: 30_000 }));
  const order = stuck.data?.find((s) => s.orderId === orderId);
  const switches = useQuery(trpc.orders.ops.switches.queryOptions(undefined, { enabled: signedIn, retry: false, staleTime: 60_000 }));
  const [open, setOpen] = useState<StaffAction | null>(null);
  if (!order || !loaded) return null;
  return (
    <>
      <StuckBanner order={order} actions={actionsFor(order, roles)} onPick={setOpen} />
      {open ? <StaffActionDialog order={order} action={open} switches={switches.data ?? null} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

export function StuckBanner({
  order,
  actions,
  onPick,
}: {
  order: Pick<StuckOrder, 'reason' | 'since'>;
  actions: readonly StaffAction[];
  onPick: (a: StaffAction) => void;
}) {
  const reason = STUCK_KEY[order.reason];
  return (
    <section
      aria-label={t('console.today.kind_stuck')}
      data-testid="stuck-strip"
      className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-warn-solid/50 bg-warn-tint px-4 py-3"
    >
      <IconAlert size={20} className="shrink-0 text-warn" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-text">
          {t('console.stuck.strip_title', { ago: compactDuration(Date.now() - new Date(order.since).getTime()), reason: reason ? t(reason) : order.reason })}
        </p>
        <p className="text-dense text-muted">{t(actions.length > 0 ? 'console.stuck.strip_hint' : 'console.stuck.strip_read_only')}</p>
      </div>
      {actions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {actions.map((a, i) => (
            <Button key={a} size="sm" variant={i === 0 ? 'primary' : a === 'cancel' || a === 'courierLost' ? 'danger-soft' : 'secondary'} onClick={() => onPick(a)} needsNet>
              {t(ACTION_KEY[a])}
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
