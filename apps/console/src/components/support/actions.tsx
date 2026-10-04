'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FaultParty, TicketCase } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useEffect, useId, useState } from 'react';
import { refundChips } from '@/lib/control-room';
import { formatIqd, formatMoney } from '@/lib/format';
import { errorText } from '@/lib/network';
import { useTRPC } from '@/lib/trpc';
import {
  Button,
  cx,
  Dialog,
  Field,
  IconAlert,
  Input,
  Meter,
  Segmented,
  Textarea,
  useToast,
} from '../ui';
import type { SupportAction } from './context';

type Funder = Exclude<FaultParty, 'customer' | 'none'>;
const FUNDERS: readonly Funder[] = ['platform', 'courier', 'merchant'];

export interface ActionPrefill {
  amountIqd?: number | null;
  fault?: Funder;
}

/**
 * One dialog per action, opened from the context pane, the header (resolve) or the keyboard (e).
 * Each says what will happen in a sentence before the button that does it; refunds show the
 * agent's and the customer's limits as meters and never let a click post twice (idempotency key).
 */
export function SupportActionDialogs({
  data,
  open,
  onClose,
  prefill,
}: {
  data: TicketCase;
  open: SupportAction | null;
  onClose: () => void;
  prefill: ActionPrefill | null;
}) {
  return (
    <>
      <RefundDialog data={data} open={open === 'refund'} onClose={onClose} prefill={prefill} />
      <FaultDialog data={data} open={open === 'fault'} onClose={onClose} prefill={prefill} />
      <NoteActionDialog data={data} kind="escalate" open={open === 'escalate'} onClose={onClose} />
      <NoteActionDialog data={data} kind="resolve" open={open === 'resolve'} onClose={onClose} />
    </>
  );
}

const newKey = () => `rf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function useSetCase(ticketId: string) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  return (res: TicketCase) => {
    qc.setQueryData(trpc.support.get.queryKey({ ticketId }), res);
    void qc.invalidateQueries({ queryKey: trpc.support.list.pathKey() });
    void qc.invalidateQueries({ queryKey: trpc.support.customer.queryKey({ ticketId }) });
  };
}

function RefundDialog({
  data,
  open,
  onClose,
  prefill,
}: {
  data: TicketCase;
  open: boolean;
  onClose: () => void;
  prefill: ActionPrefill | null;
}) {
  const trpc = useTRPC();
  const toast = useToast();
  const setCase = useSetCase(data.ticket.id);
  const lim = data.limits;
  const ids = { amount: useId() };
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'wallet' | 'points'>('wallet');
  const [fault, setFault] = useState<Funder>('platform');
  const [key, setKey] = useState(newKey);
  useEffect(() => {
    if (!open) return;
    setAmount(
      prefill?.amountIqd && prefill.amountIqd <= lim.availableIqd ? String(prefill.amountIqd) : '',
    );
    setFault(
      prefill?.fault ??
        (data.ticket.faultParty === 'courier' || data.ticket.faultParty === 'merchant'
          ? data.ticket.faultParty
          : 'platform'),
    );
    setMethod('wallet');
    setKey(newKey());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset each time it opens
  }, [open]);
  const refund = useMutation(
    trpc.support.refund.mutationOptions({
      onSuccess: (res, vars) => {
        setCase(res);
        toast({
          title: t('console.sup_refund_done', { amount: formatIqd(vars.amountIqd) }),
          tone: 'ok',
        });
        onClose();
      },
    }),
  );
  const n = Number(amount);
  const valid = Number.isInteger(n) && n >= 250 && n % 250 === 0 && n <= lim.availableIqd;
  const party = method === 'points' ? 'platform' : fault;
  const chips = refundChips(lim.availableIqd);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      labelledBy="refund-title"
      title={
        data.ticket.customerName
          ? t('console.sup_refund_title_named', { name: data.ticket.customerName })
          : t('console.sup_refund_title')
      }
      description={data.ticket.subject}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('console.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={refund.isPending}
            disabled={!valid}
            onClick={() =>
              refund.mutate({
                ticketId: data.ticket.id,
                amountIqd: n,
                method,
                faultParty: party,
                idempotencyKey: key,
              })
            }
          >
            {valid
              ? t('console.sup_refund_send', { amount: formatMoney(n) })
              : t('console.sup_refund_pick')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-dense font-medium">{t('console.sup_amount')}</p>
          <div className="flex flex-wrap gap-2">
            {chips.map((v) => (
              <button
                key={v}
                type="button"
                data-refund-chip
                aria-pressed={n === v}
                onClick={() => setAmount(String(v))}
                className={cx(
                  'num h-10 min-w-[84px] rounded-md border px-3 text-[15px] font-semibold transition-colors',
                  n === v
                    ? 'border-accent bg-accent-tint text-text'
                    : 'border-line bg-surface text-text hover:border-line-strong hover:bg-surface-2',
                )}
              >
                {formatIqd(v)}
              </button>
            ))}
            <div className="w-32">
              <label htmlFor={ids.amount} className="sr-only">
                {t('console.sup_refund_other')}
              </label>
              <Input
                id={ids.amount}
                dir="ltr"
                inputMode="numeric"
                placeholder={t('console.sup_refund_other')}
                className="h-10 text-center"
                value={chips.includes(n) ? '' : amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
                aria-invalid={amount !== '' && !valid}
              />
            </div>
          </div>
          {amount !== '' && !valid ? (
            <p className="mt-1.5 text-xs text-bad">
              {t('console.sup_refund_invalid', { amount: formatIqd(lim.availableIqd) })}
            </p>
          ) : null}
          {n > lim.cashAboveIqd ? (
            <p className="mt-2 flex items-start gap-2 rounded-md bg-warn-tint px-3 py-2 text-dense text-text">
              <IconAlert size={16} className="mt-0.5 shrink-0 text-warn" />
              {t('console.sup_cash_hint')}
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-dense font-medium">{t('console.sup_refund_method')}</p>
            <Segmented
              label={t('console.sup_refund_method')}
              value={method}
              onChange={setMethod}
              options={(['wallet', 'points'] as const).map((m) => ({
                value: m,
                label: t(`console.sup_method_${m}` as MessageKey),
              }))}
            />
          </div>
          <div>
            <p className="mb-2 text-dense font-medium">{t('console.sup_funded_by')}</p>
            <Segmented
              label={t('console.sup_funded_by')}
              value={party}
              onChange={setFault}
              options={FUNDERS.map((f) => ({
                value: f,
                label: t(`console.sup_fault_${f}` as MessageKey),
                disabled: method === 'points' && f !== 'platform',
              }))}
            />
          </div>
        </div>

        <div className="rounded-lg border border-line bg-surface-2/60 p-3">
          <p className="mb-2 text-xs font-medium text-muted">{t('console.sup_limits')}</p>
          <div className="space-y-2.5 text-dense">
            {lim.agentDailyCapIqd > 0 ? (
              <LimitRow
                label={t('console.sup_limit_agent')}
                used={lim.agentUsedTodayIqd}
                cap={lim.agentDailyCapIqd}
              />
            ) : null}
            <LimitRow
              label={t('console.sup_limit_customer')}
              used={lim.customerUsedMonthIqd}
              cap={lim.customerMonthlyCapIqd}
            />
            <p className="text-muted">
              {t('console.sup_available', { amount: formatIqd(lim.availableIqd) })}
            </p>
          </div>
        </div>

        {valid ? (
          <p className="text-sm text-text">
            {method === 'points'
              ? t('console.sup_refund_summary_points', { amount: formatIqd(n) })
              : t('console.sup_refund_summary_wallet', {
                  amount: formatIqd(n),
                  party: t(`console.sup_fault_${party}` as MessageKey),
                })}
          </p>
        ) : null}
        {refund.error ? <p className="text-sm text-bad">{errorText(refund.error)}</p> : null}
      </div>
    </Dialog>
  );
}

function LimitRow({ label, used, cap }: { label: string; used: number; cap: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2">
        <span className="text-muted">{label}</span>
        <span className="num">
          {formatIqd(used)} / {formatIqd(cap)}
        </span>
      </div>
      <Meter value={used} max={cap} label={label} />
    </div>
  );
}

function FaultDialog({
  data,
  open,
  onClose,
  prefill,
}: {
  data: TicketCase;
  open: boolean;
  onClose: () => void;
  prefill: ActionPrefill | null;
}) {
  const trpc = useTRPC();
  const toast = useToast();
  const setCase = useSetCase(data.ticket.id);
  const id = useId();
  const [party, setParty] = useState<Funder>('courier');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!open) return;
    setParty(
      prefill?.fault ??
        (data.ticket.faultParty === 'merchant' || data.ticket.faultParty === 'platform'
          ? data.ticket.faultParty
          : 'courier'),
    );
    setNote('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset each time it opens
  }, [open]);
  const fault = useMutation(
    trpc.support.attributeFault.mutationOptions({
      onSuccess: (res, vars) => {
        setCase(res);
        toast({
          title: t('console.sup_fault_saved', {
            party: t(`console.sup_fault_${vars.faultParty}` as MessageKey),
          }),
          tone: 'ok',
        });
        onClose();
      },
    }),
  );
  const ok = note.trim().length >= 3;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      labelledBy="fault-title"
      width="sm"
      title={t('console.sup_fault_title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('console.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!ok}
            loading={fault.isPending}
            onClick={() =>
              fault.mutate({ ticketId: data.ticket.id, faultParty: party, note: note.trim() })
            }
          >
            {t('console.sup_fault_save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented
          label={t('console.sup_fault_title')}
          value={party}
          onChange={setParty}
          options={(['courier', 'merchant', 'platform'] as const).map((f) => ({
            value: f,
            label: t(`console.sup_fault_${f}` as MessageKey),
          }))}
        />
        <Field label={t('console.sup_fault_note')} htmlFor={id}>
          <Textarea
            id={id}
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('console.sup_action_placeholder')}
          />
        </Field>
        {fault.error ? <p className="text-sm text-bad">{errorText(fault.error)}</p> : null}
      </div>
    </Dialog>
  );
}

function NoteActionDialog({
  data,
  kind,
  open,
  onClose,
}: {
  data: TicketCase;
  kind: 'escalate' | 'resolve';
  open: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const toast = useToast();
  const setCase = useSetCase(data.ticket.id);
  const id = useId();
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) setNote('');
  }, [open]);
  const done = (res: TicketCase) => {
    setCase(res);
    toast({
      title: t(kind === 'escalate' ? 'console.sup_escalated_toast' : 'console.sup_resolved_toast'),
      tone: 'ok',
    });
    onClose();
  };
  const escalate = useMutation(trpc.support.escalate.mutationOptions({ onSuccess: done }));
  const resolve = useMutation(trpc.support.resolve.mutationOptions({ onSuccess: done }));
  const m = kind === 'escalate' ? escalate : resolve;
  const ok = note.trim().length >= 3;
  const submit = () => {
    if (!ok) return;
    if (kind === 'escalate') escalate.mutate({ ticketId: data.ticket.id, reason: note.trim() });
    else resolve.mutate({ ticketId: data.ticket.id, resolution: note.trim() });
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      labelledBy={`${kind}-title`}
      width="sm"
      title={t(kind === 'escalate' ? 'console.sup_escalate_title' : 'console.sup_resolve_title')}
      description={
        kind === 'escalate' ? t('console.sup_escalate_desc') : t('console.sup_resolve_hint')
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('console.cancel')}
          </Button>
          <Button
            variant={kind === 'escalate' ? 'danger' : 'primary'}
            disabled={!ok}
            loading={m.isPending}
            onClick={submit}
          >
            {t(kind === 'escalate' ? 'console.sup_escalate' : 'console.sup_resolve')}
          </Button>
        </>
      }
    >
      <Field
        label={t(
          kind === 'escalate' ? 'console.sup_escalate_reason' : 'console.sup_resolve_reason',
        )}
        htmlFor={id}
      >
        <Textarea
          id={id}
          rows={3}
          maxLength={kind === 'escalate' ? 500 : 1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t(
            kind === 'escalate'
              ? 'console.sup_escalate_placeholder'
              : 'console.sup_resolve_placeholder',
          )}
        />
      </Field>
      {m.error ? <p className="mt-2 text-sm text-bad">{errorText(m.error)}</p> : null}
    </Dialog>
  );
}
