'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FaultParty, type StuckOrder } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useId, useState } from 'react';
import { formatIqd } from '@/lib/format';
import { errorText } from '@/lib/network';
import {
  ACTION_KEY,
  consequences,
  DONE_KEY,
  OUTCOME_HINT_KEY,
  OUTCOME_KEY,
  outcomesFor,
  QUICK_REASONS,
  REASON_MAX,
  REASON_MIN,
  type DisputeOutcomeChoice,
  type OpsSwitches,
  type StaffAction,
} from '@/lib/staff-actions';
import { useTRPC } from '@/lib/trpc';
import { Button, Checkbox, cx, Dialog, Field, IconClock, Input, Segmented, Textarea, useToast } from '../ui';

const FAULT_KEY: Record<FaultParty, MessageKey> = {
  none: 'console.sup_fault_none',
  courier: 'console.sup_fault_courier',
  merchant: 'console.sup_fault_merchant',
  platform: 'console.sup_fault_platform',
  customer: 'console.sup_fault_customer',
};

/**
 * One staff way-out on a stuck order: what will happen (and which part still waits on Ali), a reason
 * that goes to the audit log, the action's own fields, then the call. The server refuses what the
 * order's state or a money switch doesn't allow; its message is shown here, in the dialog.
 */
export function StaffActionDialog({
  order,
  action,
  switches = null,
  onClose,
}: {
  order: Pick<StuckOrder, 'orderId' | 'ticket' | 'totalIqd' | 'paymentMethod'>;
  action: StaffAction;
  /** Lane A's `orders.ops.switches`; null until it is on main (money lines then read "waits on Ali"). */
  switches?: OpsSwitches | null;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const ids = { reason: useId(), cash: useId(), amount: useId() };
  const [reason, setReason] = useState('');
  const [onBehalf, setOnBehalf] = useState(false);
  const [cash, setCash] = useState('');
  const [outcome, setOutcome] = useState<DisputeOutcomeChoice>('stands');
  const [amount, setAmount] = useState('');
  const [fault, setFault] = useState<FaultParty>('platform');
  const [tried, setTried] = useState(false);

  const done = (r: { changed: boolean }) => {
    toast({ title: t(r.changed ? DONE_KEY[action] : 'console.stuck.no_change'), tone: r.changed ? 'ok' : undefined });
    void qc.invalidateQueries({ queryKey: trpc.orders.ops.stuck.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.orders.get.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.orders.events.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.inbox.list.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.inbox.counts.queryKey() });
    onClose();
  };
  const opts = { onSuccess: done };
  const cancel = useMutation(trpc.orders.ops.cancel.mutationOptions(opts));
  const markDelivered = useMutation(trpc.orders.ops.markDelivered.mutationOptions(opts));
  const close = useMutation(trpc.orders.ops.close.mutationOptions(opts));
  const courierLost = useMutation(trpc.orders.ops.courierLost.mutationOptions(opts));
  const resolve = useMutation(trpc.orders.ops.resolveDispute.mutationOptions(opts));
  const m = { cancel, markDelivered, close, courierLost, resolveDispute: resolve }[action];

  const why = reason.trim();
  const reasonBad = why.length < REASON_MIN;
  const cashIqd = cash.trim() === '' ? undefined : Number(cash);
  const cashBad = cashIqd !== undefined && !(Number.isInteger(cashIqd) && cashIqd >= 0);
  const amountIqd = Number(amount);
  const amountBad = action === 'resolveDispute' && outcome === 'refund_partial' && !(Number.isInteger(amountIqd) && amountIqd > 0);
  const refund = outcome === 'refund_full' || outcome === 'refund_partial';

  const submit = () => {
    setTried(true);
    if (reasonBad || cashBad || amountBad) return;
    const base = { orderId: order.orderId, reason: why };
    switch (action) {
      case 'cancel':
        return cancel.mutate({ ...base, onBehalfOfCustomer: onBehalf });
      case 'markDelivered':
        return markDelivered.mutate({ ...base, ...(cashIqd !== undefined ? { cashCollectedIqd: cashIqd } : {}) });
      case 'close':
        return close.mutate(base);
      case 'courierLost':
        return courierLost.mutate(base);
      case 'resolveDispute':
        return resolve.mutate({
          ...base,
          outcome,
          faultParty: refund ? fault : 'platform',
          ...(outcome === 'refund_partial' ? { amountIqd } : {}),
        });
    }
  };

  const lines = consequences(action, order, switches);
  const danger = action === 'cancel' || action === 'courierLost';
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('console.stuck.dialog_title', { action: t(ACTION_KEY[action]), n: order.ticket })}
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {lines.length > 0 ? (
          <section aria-label={t('console.stuck.what_happens')}>
            <h3 className="text-dense font-medium text-faint">{t('console.stuck.what_happens')}</h3>
            <ul className="mt-1.5 space-y-1.5 text-sm">
              {lines.map((l) =>
                l.waits ? (
                  <li key={l.key} className="flex items-start gap-2 rounded-md border border-warn-solid/40 bg-warn-tint px-3 py-2 text-text" data-testid="waits-ali">
                    <IconClock size={16} className="mt-0.5 shrink-0 text-warn" />
                    <span>{t(l.key)}</span>
                  </li>
                ) : (
                  <li key={l.key} className="flex items-start gap-2 text-text">
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-line-strong" />
                    <span>{t(l.key)}</span>
                  </li>
                ),
              )}
            </ul>
          </section>
        ) : null}

        {action === 'resolveDispute' ? (
          <>
            <Field label={t('console.stuck.dispute_outcome')} hint={t(OUTCOME_HINT_KEY[outcome])}>
              <Segmented<DisputeOutcomeChoice>
                label={t('console.stuck.dispute_outcome')}
                value={outcome}
                onChange={setOutcome}
                options={outcomesFor(switches).map((o) => ({ value: o, label: t(OUTCOME_KEY[o]) }))}
              />
            </Field>
            {outcome === 'refund_partial' ? (
              <Field label={t('console.stuck.amount')} htmlFor={ids.amount} error={tried && amountBad ? t('console.stuck.amount') : undefined}>
                <Input id={ids.amount} inputMode="numeric" dir="ltr" className="num w-40" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} />
              </Field>
            ) : null}
            {refund ? (
              <Field label={t('console.stuck.fault')} hint={switches ? t('console.stuck.over_limit_amt', { amount: formatIqd(switches.agentLimitIqd) }) : t('console.stuck.over_limit')}>
                <Segmented<FaultParty>
                  label={t('console.stuck.fault')}
                  value={fault}
                  onChange={setFault}
                  options={(['platform', 'courier', 'merchant'] as const).map((f) => ({ value: f, label: t(FAULT_KEY[f]) }))}
                />
              </Field>
            ) : null}
          </>
        ) : null}

        {action === 'markDelivered' && order.paymentMethod === 'cash' ? (
          <Field
            label={t('console.stuck.md_cash')}
            htmlFor={ids.cash}
            hint={t('console.stuck.md_cash_hint', { amount: formatIqd(order.totalIqd) })}
          >
            <Input
              id={ids.cash}
              inputMode="numeric"
              dir="ltr"
              className="num w-40"
              placeholder={formatIqd(order.totalIqd)}
              value={cash}
              onChange={(e) => setCash(e.target.value.replace(/[^\d]/g, ''))}
            />
          </Field>
        ) : null}

        <Field
          label={t('console.stuck.reason')}
          htmlFor={ids.reason}
          hint={t('console.stuck.reason_hint')}
          error={tried && reasonBad ? t('console.stuck.reason_required') : undefined}
        >
          <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label={t('console.stuck.quick')}>
            {QUICK_REASONS[action].map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={why === t(k)}
                onClick={() => setReason(t(k))}
                className={cx(
                  'min-h-8 rounded-full border px-3 text-dense transition-colors',
                  why === t(k) ? 'border-accent bg-accent-tint font-medium text-text' : 'border-line bg-surface text-text hover:border-line-strong',
                )}
              >
                {t(k)}
              </button>
            ))}
          </div>
          <Textarea id={ids.reason} rows={2} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        {action === 'cancel' ? (
          <Checkbox
            label={t('console.stuck.cancel_on_behalf')}
            hint={t('console.stuck.cancel_on_behalf_hint')}
            checked={onBehalf}
            onChange={setOnBehalf}
          />
        ) : null}

        {m.error ? (
          <p role="alert" className="rounded-md bg-bad-tint px-3 py-2 text-sm text-bad" data-testid="action-error">
            {errorText(m.error)}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('console.stuck.back')}
          </Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} loading={m.isPending} needsNet>
            {t(ACTION_KEY[action])}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
