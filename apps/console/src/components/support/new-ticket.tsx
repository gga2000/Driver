'use client';

import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { parseOrderTicket, type TicketChannel, type TicketKind } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useEffect, useId, useState } from 'react';
import { formatDayClock } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { orderLabel } from '@/lib/names';
import { errorText } from '@/lib/network';
import { useTRPC } from '@/lib/trpc';
import { OrgName } from '../named';
import { Button, cx, Dialog, Field, Input, Segmented, Textarea, useToast } from '../ui';

const KINDS: readonly TicketKind[] = ['complaint', 'dispute', 'incident', 'question'];
const CHANNELS: readonly TicketChannel[] = ['phone', 'whatsapp', 'in_app'];

/** A ticket for a call or a WhatsApp message. "#1284" as the customer says it finds the order (K-02). */
export function NewTicketDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const trpc = useTRPC();
  const router = useRouter();
  const toast = useToast();
  const ids = { subject: useId(), order: useId(), note: useId() };
  const [kind, setKind] = useState<TicketKind>('complaint');
  const [channel, setChannel] = useState<TicketChannel>('phone');
  const [subject, setSubject] = useState('');
  const [orderId, setOrderId] = useState('');
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const ticket = parseOrderTicket(orderId);
  const matches = useQuery(
    trpc.orders.search.queryOptions(
      { cityId: CITY_ID, text: orderId.trim(), limit: 10 },
      { enabled: open && ticket !== null, retry: queryRetry },
    ),
  );
  const found = ticket ? (matches.data?.rows ?? []) : [];
  const chosenOrder = ticket
    ? (found.find((r) => r.id === picked)?.id ?? (found.length === 1 ? found[0]!.id : null))
    : orderId.trim() || null;
  const create = useMutation(
    trpc.support.open.mutationOptions({
      onSuccess: (tk) => {
        toast({ title: t('console.sup_opened_toast'), tone: 'ok' });
        onClose();
        router.push(`/support/${encodeURIComponent(tk.id)}`);
      },
    }),
  );
  useEffect(() => {
    if (!open) return;
    setSubject('');
    setOrderId('');
    setPicked(null);
    setNote('');
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when opened
  }, [open]);
  const ready = subject.trim().length >= 3 && !(ticket && !chosenOrder);
  const submit = () => {
    if (!ready) return;
    create.mutate({
      cityId: CITY_ID,
      kind,
      channel,
      subject: subject.trim(),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(chosenOrder ? { orderId: chosenOrder } : {}),
    });
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      labelledBy="new-ticket"
      title={t('console.sup_new')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('console.cancel')}
          </Button>
          <Button variant="primary" loading={create.isPending} disabled={!ready} onClick={submit}>
            {t('console.sup_open_ticket')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-wrap gap-3">
          <Segmented
            label={t('console.sup_col_subject')}
            value={kind}
            onChange={setKind}
            options={KINDS.map((k) => ({
              value: k,
              label: t(`console.sup_kind_${k}` as MessageKey),
            }))}
          />
          <Segmented
            label={t('console.sup_channel')}
            value={channel}
            onChange={setChannel}
            options={CHANNELS.map((c) => ({
              value: c,
              label: t(`console.sup_channel_${c}` as MessageKey),
            }))}
          />
        </div>
        <Field label={t('console.sup_subject')} htmlFor={ids.subject}>
          <Input
            id={ids.subject}
            required
            minLength={3}
            maxLength={200}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </Field>
        <Field
          label={t('console.sup_order_id')}
          htmlFor={ids.order}
          error={
            ticket && matches.isSuccess && found.length === 0
              ? t('console.sup_order_none')
              : undefined
          }
        >
          <Input
            id={ids.order}
            dir="ltr"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            autoComplete="off"
            placeholder="#1284"
            className="num"
          />
        </Field>
        {found.length > 0 ? (
          <fieldset>
            <legend className="mb-1.5 text-xs text-muted">{t('console.sup_order_pick')}</legend>
            <div className="flex flex-col gap-1.5">
              {found.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={chosenOrder === r.id}
                  onClick={() => setPicked(r.id)}
                  title={r.id}
                  className={cx(
                    'flex h-10 items-center justify-between gap-3 rounded-md border px-3 text-sm',
                    chosenOrder === r.id
                      ? 'border-accent bg-accent-tint'
                      : 'border-line hover:bg-surface-2',
                  )}
                >
                  <span className="num font-semibold">{orderLabel(r.id)}</span>
                  <span className="flex min-w-0 items-center gap-2 text-xs text-muted">
                    {r.merchantOrgId && <OrgName id={r.merchantOrgId} copy={false} />}
                    <span className="num">{formatDayClock(r.placedAt)}</span>
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}
        <Field label={t('console.sup_note')} htmlFor={ids.note}>
          <Textarea
            id={ids.note}
            rows={3}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {create.error ? <p className="text-sm text-bad">{errorText(create.error)}</p> : null}
      </form>
    </Dialog>
  );
}
