'use client';

import dynamic from 'next/dynamic';
import type { RoleKind } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useState } from 'react';
import { useMyRoles } from '@/lib/me';
import { Button, cx } from '../ui';

/** The router's `ORDER_OPS_ROLES` (kept here so the Console doesn't import the routers). */
const ROLES: readonly RoleKind[] = ['dispatcher', 'support', 'admin'];

const ErrandReceiptDialog = dynamic(() => import('./receipt-dialog').then((m) => m.ErrandReceiptDialog), { ssr: false });

/** An errand stays `placed` until the shopper picks up at the shops (the server has the last word). */
const OPEN_STATES = new Set(['placed']);

export function errandReceiptOpen(o: { type: string; state: string }): boolean {
  return o.type === 'errand' && OPEN_STATES.has(o.state);
}

/**
 * «سجّل الوصل»: the button that opens the receipt dialog, for the people who may use it
 * (`ROLES`). Sits on Today's over-the-ceiling row and on an open «دوّرلي» order's page.
 */
export function ErrandReceiptAction({ orderId, ticket, ceilingIqd, banner = false }: { orderId: string; ticket?: string | null; ceilingIqd?: number | null; banner?: boolean }) {
  const { roles } = useMyRoles();
  const [open, setOpen] = useState(false);
  if (!ROLES.some((r) => roles.has(r))) return null;
  return (
    <div
      className={cx('flex w-full flex-wrap items-center gap-2', banner ? 'mb-4 rounded-lg border border-line bg-surface px-4 py-3 shadow-card' : 'border-t border-line pt-3')}
      data-testid="errand-receipt-action"
    >
      <span className="me-auto text-dense text-muted">{t('console.errand.hint')}</span>
      <Button size="sm" variant={banner ? 'secondary' : 'primary'} onClick={() => setOpen(true)} needsNet>
        {t('console.errand.act')}
      </Button>
      {open ? <ErrandReceiptDialog orderId={orderId} ticket={ticket ?? null} ceilingIqd={ceilingIqd ?? null} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
