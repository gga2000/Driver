'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACCOUNT_CLOSE_RULES, type AccountCloseBlocker } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useId, useState } from 'react';
import { formatDayClock, formatMoney } from '@/lib/format';
import { hasAny, useMyRoles } from '@/lib/me';
import { errorText } from '@/lib/network';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { PersonName } from './named';
import { Button, Chip, cx, Dialog, Field, IconStop, Textarea, useToast } from './ui';

/**
 * Close a partner's or merchant's account and erase his data (docs/api/account-close.md), admin only.
 * Shown on his «احذف حسابي» support case and on his book. The server refuses while he holds cash, has
 * a job open or money is unsettled — the card lists what is left; once clear, a dialog with a required
 * note (audited, it resolves the case) closes it for good.
 */
export function AccountClose({ personId, ticketId, className }: { personId: string; ticketId?: string; className?: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const signedIn = useSignedIn();
  const { roles } = useMyRoles();
  const can = hasAny(roles, ['admin']);
  const key = trpc.identity.closeAccount.check.queryKey({ personId });
  const view = useQuery(trpc.identity.closeAccount.check.queryOptions({ personId }, { enabled: signedIn && can, retry: false }));
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const noteId = useId();
  const close = useMutation(
    trpc.identity.closeAccount.close.mutationOptions({
      onSuccess: () => {
        toast({ title: t('console.close_done'), tone: 'ok' });
        setOpen(false);
        setNote('');
        void qc.invalidateQueries({ queryKey: key });
        if (ticketId) void qc.invalidateQueries({ queryKey: trpc.support.get.queryKey({ ticketId }) });
      },
      onError: (e) => toast({ title: errorText(e as { message?: string }), tone: 'bad' }),
    }),
  );

  if (!can || !view.data || !view.data.closable) return null;
  const v = view.data;
  const blocked = v.blockers.length > 0;
  return (
    <section
      aria-label={t('console.close_title')}
      data-testid="account-close"
      className={cx('flex flex-wrap items-start gap-x-4 gap-y-2 rounded-lg border px-4 py-3', v.closedAt ? 'border-line bg-surface-2' : 'border-bad-solid/40 bg-surface', className)}
    >
      <IconStop size={18} className={cx('mt-0.5 shrink-0', v.closedAt ? 'text-muted' : 'text-bad')} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 font-semibold text-text">
          {t('console.close_title')}
          <span aria-hidden className="text-faint">
            ·
          </span>
          <PersonName id={personId} copy={false} />
        </p>
        {v.closedAt ? (
          <p className="num mt-0.5 text-dense text-muted">{t('console.close_closed', { time: formatDayClock(v.closedAt) })}</p>
        ) : blocked ? (
          <div className="mt-1 text-dense">
            <p className="text-muted">{t('console.close_blocked')}</p>
            <ul className="mt-1 flex flex-wrap gap-1.5" data-testid="account-close-blockers">
              {v.blockers.map((b) => (
                <li key={b.kind}>
                  <Chip tone="warn" size="sm">
                    <span className="num">{blockerText(b)}</span>
                  </Chip>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-dense text-muted">{t('console.close_hint')}</p>
        )}
      </div>
      {v.closedAt ? null : (
        <Button size="sm" variant="danger-soft" disabled={blocked} onClick={() => setOpen(true)} needsNet data-testid="account-close-open">
          {t('console.close_go')}
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        width="sm"
        title={t('console.close_dialog_title')}
        description={t('console.close_dialog_body')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('console.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={close.isPending}
              disabled={note.trim().length < ACCOUNT_CLOSE_RULES.noteMin}
              needsNet
              data-testid="account-close-confirm"
              onClick={() => close.mutate({ personId, note: note.trim(), ...(ticketId ? { ticketId } : {}) })}
            >
              {t('console.close_go')}
            </Button>
          </>
        }
      >
        <div className="pb-2">
          <Field label={t('console.close_note')} htmlFor={noteId} hint={t('console.close_note_hint')}>
            <Textarea id={noteId} rows={3} maxLength={ACCOUNT_CLOSE_RULES.noteMax} value={note} required onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </section>
  );
}

function blockerText(b: AccountCloseBlocker): string {
  const amount = formatMoney(b.amountIqd ?? 0);
  switch (b.kind) {
    case 'cash_held':
      return t('console.close_block_cash_held', { amount });
    case 'open_jobs':
      return t('console.close_block_open_jobs', { count: b.count ?? 0 });
    case 'unpaid_settlement':
      return t('console.close_block_unpaid_settlement', { amount });
    case 'wallet_balance':
      return t('console.close_block_wallet_balance', { amount });
    case 'sole_owner_of_open_store':
      return t('console.close_block_sole_owner_of_open_store', { count: b.count ?? 0 });
  }
}
