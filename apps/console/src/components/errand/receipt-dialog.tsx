'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { t, type MessageKey } from '@driver/i18n';
import { useId, useState } from 'react';
import { formatIqd } from '@/lib/format';
import { errorText } from '@/lib/network';
import { REASON_MAX, REASON_MIN } from '@/lib/staff-actions';
import { useTRPC } from '@/lib/trpc';
import { Button, cx, Dialog, Field, Input, Textarea, useToast } from '../ui';

const QUICK: readonly MessageKey[] = ['console.errand.q_photo_failed', 'console.errand.q_read_out', 'console.errand.q_customer_ok'];

/**
 * «دوّرلي»: ops type the shopper's receipt for him when his photo won't send, so he is never stuck at
 * the shop (lane A's `orders.ops.recordErrandReceipt`). The server checks the order is an errand
 * with its shop stop still open, recomputes what the customer pays and writes the audit row; the
 * Console sends only the amount read out and the reason.
 */
export function ErrandReceiptDialog({ orderId, ticket, ceilingIqd = null, onClose }: { orderId: string; ticket?: string | null; ceilingIqd?: number | null; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const ids = { amount: useId(), reason: useId() };
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);

  const save = useMutation(
    trpc.orders.ops.recordErrandReceipt.mutationOptions({
      onSuccess: (r) => {
        toast({ title: t(r.changed ? 'console.errand.done' : 'console.stuck.no_change'), tone: r.changed ? 'ok' : undefined });
        void qc.invalidateQueries({ queryKey: trpc.orders.get.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.orders.events.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.inbox.list.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.inbox.counts.queryKey() });
        onClose();
      },
    }),
  );

  const totalIqd = Number(amount);
  const amountBad = !(Number.isInteger(totalIqd) && totalIqd > 0);
  const why = reason.trim();
  const reasonBad = why.length < REASON_MIN;
  const over = !amountBad && ceilingIqd !== null && totalIqd > ceilingIqd;
  const submit = () => {
    setTried(true);
    if (amountBad || reasonBad) return;
    save.mutate({ orderId, totalIqd, reason: why });
  };

  return (
    <Dialog open onClose={onClose} title={ticket ? t('console.stuck.dialog_title', { action: t('console.errand.act'), n: ticket }) : t('console.errand.act')}>
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <section aria-label={t('console.stuck.what_happens')}>
          <h3 className="text-dense font-medium text-faint">{t('console.stuck.what_happens')}</h3>
          <ul className="mt-1.5 space-y-1.5 text-sm">
            {(['console.errand.what_total', 'console.errand.what_pickup', 'console.errand.what_audit'] as const).map((k) => (
              <li key={k} className="flex items-start gap-2 text-text">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-line-strong" />
                <span>{t(k)}</span>
              </li>
            ))}
          </ul>
        </section>

        <Field
          label={t('console.errand.amount')}
          htmlFor={ids.amount}
          hint={ceilingIqd !== null ? t('console.errand.amount_ceiling', { ceiling: formatIqd(ceilingIqd) }) : t('console.errand.amount_hint')}
          error={tried && amountBad ? t('console.errand.amount_required') : undefined}
        >
          <Input id={ids.amount} inputMode="numeric" dir="ltr" autoFocus className="num w-40" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} />
        </Field>
        {over ? (
          <p className="rounded-md border border-warn-solid/40 bg-warn-tint px-3 py-2 text-sm text-text" data-testid="errand-over">
            {t('console.errand.over_note', { ceiling: formatIqd(ceilingIqd!) })}
          </p>
        ) : null}

        <Field label={t('console.stuck.reason')} htmlFor={ids.reason} hint={t('console.stuck.reason_hint')} error={tried && reasonBad ? t('console.stuck.reason_required') : undefined}>
          <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label={t('console.stuck.quick')}>
            {QUICK.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={why === t(k)}
                onClick={() => setReason(t(k))}
                className={cx('min-h-8 rounded-full border px-3 text-dense transition-colors', why === t(k) ? 'border-accent bg-accent-tint font-medium text-text' : 'border-line bg-surface text-text hover:border-line-strong')}
              >
                {t(k)}
              </button>
            ))}
          </div>
          <Textarea id={ids.reason} rows={2} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        {save.error ? (
          <p role="alert" className="rounded-md bg-bad-tint px-3 py-2 text-sm text-bad" data-testid="action-error">
            {errorText(save.error)}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('console.stuck.back')}
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending} needsNet>
            {t('console.errand.act')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
