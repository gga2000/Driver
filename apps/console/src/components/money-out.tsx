'use client';

import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PayoutChannel } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useEffect, useId, useState } from 'react';
import { CITY_ID } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { ACCOUNT_KEY, ACCOUNT_KINDS, accountId, adjustProblem, CHANNEL_KEY, DRIVER_CHANNELS, MERCHANT_CHANNELS, MONEY_OUT_ROLES, needsOwner, payAmountProblem, payKey, SECOND_OK_ABOVE_IQD, type AccountKind } from '@/lib/money-out';
import { formatIqd } from '@/lib/format';
import { parseAmount } from '@/lib/round';
import { useTRPC } from '@/lib/trpc';
import { Button, Card, Dialog, Field, Input, Segmented, Select, Textarea, useToast } from './ui';

/** Whether the signed-in person may pay out or correct the ledger (finance). */
export function useCanPayOut(): boolean {
  const { roles } = useMyRoles();
  return hasAny(roles, MONEY_OUT_ROLES);
}

type PayTarget = { kind: 'merchant'; id: string; name: string; maxIqd: number } | { kind: 'driver'; id: string; name: string; maxIqd: number; suggestIqd: number };

/**
 * «ادفع»: the company pays a restaurant what it is owed (`finance.payMerchant`) or a driver what it
 * owes him (`finance.payDriver`). The amount starts at what is owed and cannot go above it; the
 * channel is how the money leaves (ZainCash, an agent, the ops round, a bank transfer). The toast
 * gives the settlement reference to type into the transfer note.
 */
export function PayDialog({ target, onClose }: { target: PayTarget | null; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const amountId = useId();
  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState<PayoutChannel>('zaincash');
  const [key, setKey] = useState('');
  const targetKey = target ? `${target.kind}:${target.id}` : null;
  // A fresh form per opening: not on every refresh, which would wipe what was typed.
  useEffect(() => {
    if (!target) return;
    setAmount(formatIqd(target.kind === 'driver' ? target.suggestIqd : target.maxIqd));
    setChannel('zaincash');
    setKey(payKey(target.kind, target.id, Date.now()));
  }, [targetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (r: { reference: string; amountIqd: number }) => {
    toast({ title: t('console.pay_done', { amount: formatIqd(r.amountIqd), name: target?.name ?? '' }), body: t('console.pay_reference', { ref: r.reference }), tone: 'ok' });
    void qc.invalidateQueries(trpc.finance.desk.pathFilter());
    void qc.invalidateQueries(trpc.ledger.driverLedger.pathFilter());
    onClose();
  };
  const fail = (e: { message: string }) => toast({ title: t('console.pay_failed'), body: e.message, tone: 'bad' });
  const payMerchant = useMutation(trpc.finance.payMerchant.mutationOptions({ onSuccess: done, onError: fail }));
  const payDriver = useMutation(trpc.finance.payDriver.mutationOptions({ onSuccess: done, onError: fail }));
  const pending = payMerchant.isPending || payDriver.isPending;
  const value = parseAmount(amount);
  const problem = payAmountProblem(value, target?.maxIqd ?? 0);
  const channels = target?.kind === 'merchant' ? MERCHANT_CHANNELS : DRIVER_CHANNELS;
  const submit = () => {
    if (!target || problem || pending) return;
    if (target.kind === 'merchant') payMerchant.mutate({ cityId: CITY_ID, merchantId: target.id, amountIqd: value, channel: channel === 'agent' ? 'zaincash' : channel, idempotencyKey: key });
    else payDriver.mutate({ cityId: CITY_ID, driverId: target.id, amountIqd: value, channel, idempotencyKey: key });
  };
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      width="sm"
      title={t(target?.kind === 'driver' ? 'console.pay_driver_title' : 'console.pay_merchant_title', { name: target?.name ?? '' })}
      description={t(target?.kind === 'driver' ? 'console.pay_driver_desc' : 'console.pay_merchant_desc')}
      footer={
        <Button variant="primary" size="lg" needsNet disabled={problem !== null} loading={pending} onClick={submit} data-testid="pay-confirm">
          {t('console.pay_confirm', { amount: formatIqd(value) })}
        </Button>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={t('console.pay_amount')} htmlFor={amountId} hint={t(target?.kind === 'driver' ? 'console.pay_max_driver' : 'console.pay_max_merchant', { amount: formatIqd(target?.maxIqd ?? 0) })} error={problem === 'too_much' ? t('console.pay_too_much') : undefined}>
          <Input id={amountId} data-testid="pay-amount" inputMode="numeric" dir="ltr" className="num text-end text-base" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={problem === 'too_much'} />
        </Field>
        <Field label={t('console.pay_channel')}>
          <Segmented label={t('console.pay_channel')} value={channel} onChange={setChannel} options={channels.map((c) => ({ value: c, label: t(CHANNEL_KEY[c]) }))} className="flex-wrap" />
        </Field>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

/** One side of a correction: which kind of account, and whose. */
function AccountPicker({ label, kind, owner, onKind, onOwner, testId }: { label: string; kind: AccountKind; owner: string; onKind: (k: AccountKind) => void; onOwner: (v: string) => void; testId: string }) {
  const kindId = useId();
  const ownerId = useId();
  return (
    <fieldset className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <legend className="sr-only">{label}</legend>
      <Field label={label} htmlFor={kindId}>
        <Select id={kindId} data-testid={`${testId}-kind`} value={kind} onChange={(e) => onKind(e.target.value as AccountKind)}>
          {ACCOUNT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(ACCOUNT_KEY[k])}
            </option>
          ))}
        </Select>
      </Field>
      {needsOwner(kind) ? (
        <Field label={t('console.adj_owner')} htmlFor={ownerId} hint={t('console.adj_owner_hint')}>
          <Input id={ownerId} data-testid={`${testId}-owner`} dir="ltr" autoComplete="off" className="font-mono text-sm" value={owner} onChange={(e) => onOwner(e.target.value)} />
        </Field>
      ) : null}
    </fieldset>
  );
}

/**
 * «تصحيح الدفتر» (G-85): a hand-written correction from one money account to another, with a reason
 * and the support ticket it answers. Up to 25,000 it posts at once; above it, nothing posts until a
 * second finance person approves it in the second-OK queue (Console › الموافقات).
 */
export function AdjustCard() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const amountId = useId();
  const reasonId = useId();
  const ticketId = useId();
  const [fromKind, setFromKind] = useState<AccountKind>('platform');
  const [fromOwner, setFromOwner] = useState('');
  const [toKind, setToKind] = useState<AccountKind>('driver');
  const [toOwner, setToOwner] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [incident, setIncident] = useState('');
  const draft = { from: accountId(fromKind, fromOwner), to: accountId(toKind, toOwner), amountIqd: parseAmount(amount), reason, incidentId: incident };
  const problem = adjustProblem(draft);
  const adjust = useMutation(
    trpc.finance.adjust.mutationOptions({
      onSuccess: (r) => {
        toast({
          title: r.status === 'posted' ? t('console.adj_posted', { amount: formatIqd(r.amountIqd) }) : t('console.adj_waiting', { amount: formatIqd(r.amountIqd) }),
          tone: r.status === 'posted' ? 'ok' : 'default',
        });
        setAmount('');
        setReason('');
        void qc.invalidateQueries(trpc.finance.desk.pathFilter());
        void qc.invalidateQueries(trpc.support.refundApprovals.list.pathFilter());
      },
      onError: (e) => toast({ title: t('console.adj_failed'), body: e.message, tone: 'bad' }),
    }),
  );
  const submit = () => {
    if (problem || adjust.isPending || !draft.from || !draft.to) return;
    adjust.mutate({ cityId: CITY_ID, fromAccount: draft.from, toAccount: draft.to, amountIqd: draft.amountIqd, reason: reason.trim(), incidentId: incident.trim() });
  };
  const second = draft.amountIqd > SECOND_OK_ABOVE_IQD;
  return (
    <div data-testid="adjust-card">
    <Card title={t('console.adj_title')} hint={t('console.adj_hint')}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <AccountPicker label={t('console.adj_from')} kind={fromKind} owner={fromOwner} onKind={setFromKind} onOwner={setFromOwner} testId="adj-from" />
        <AccountPicker label={t('console.adj_to')} kind={toKind} owner={toOwner} onKind={setToKind} onOwner={setToOwner} testId="adj-to" />
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Field label={t('console.adj_amount')} htmlFor={amountId} hint={second ? t('console.adj_second_ok', { amount: formatIqd(SECOND_OK_ABOVE_IQD) }) : undefined}>
            <Input id={amountId} data-testid="adj-amount" inputMode="numeric" dir="ltr" className="num text-end" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={t('console.adj_ticket')} htmlFor={ticketId} hint={t('console.adj_ticket_hint')}>
            <Input id={ticketId} data-testid="adj-ticket" dir="ltr" autoComplete="off" className="font-mono text-sm" value={incident} onChange={(e) => setIncident(e.target.value)} />
          </Field>
        </div>
        <Field label={t('console.adj_reason')} htmlFor={reasonId} error={problem === 'same' ? t('console.adj_same') : undefined}>
          <Textarea id={reasonId} data-testid="adj-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/approvals" className="text-dense text-accent-text hover:underline">
            {t('console.adj_queue')}
          </Link>
          <Button type="submit" variant={second ? 'secondary' : 'primary'} needsNet disabled={problem !== null} loading={adjust.isPending} data-testid="adj-submit">
            {draft.amountIqd <= 0 ? t('console.adj_send_plain') : second ? t('console.adj_send_second', { amount: formatIqd(draft.amountIqd) }) : t('console.adj_send', { amount: formatIqd(draft.amountIqd) })}
          </Button>
        </div>
      </form>
    </Card>
    </div>
  );
}
