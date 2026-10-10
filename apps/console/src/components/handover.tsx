'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HANDOVER_RULES } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useId, useState } from 'react';
import { formatClock } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { errorText } from '@/lib/network';
import { useTRPC } from '@/lib/trpc';
import { PersonName } from './named';
import { Button, Dialog, Field, IconNote, Textarea, useToast } from './ui';

const POLL_MS = 60_000;

function useHandover() {
  const trpc = useTRPC();
  return useQuery(trpc.onCall.handover.queryOptions({ cityId: CITY_ID }, { retry: queryRetry, refetchInterval: POLL_MS }));
}

/**
 * The shift handover note on Today (h5): what the last shift wants the next one to know, on top of
 * the page until this person taps «وصلت». Read notes leave the page (the write button stays).
 */
export function HandoverCard() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const note = useHandover();
  const ack = useMutation(
    trpc.onCall.handoverAck.mutationOptions({
      onSuccess: (n) => qc.setQueryData(trpc.onCall.handover.queryKey({ cityId: CITY_ID }), n),
      onError: (e) => toast({ title: t('console.today.failed', { message: errorText(e) }), tone: 'bad' }),
    }),
  );
  const n = note.data;
  if (!n || n.ackedByMe) return null;
  return (
    <section
      className="flex flex-wrap items-start gap-x-4 gap-y-3 rounded-lg border border-accent/45 bg-accent-wash/60 px-5 py-4"
      aria-labelledby="handover-title"
      data-testid="handover-card"
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-accent text-on-accent">
        <IconNote size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="handover-title" className="text-sm font-semibold text-text">
          {t('console.handover.title')}
        </h2>
        <p className="num mt-0.5 text-dense text-muted">
          {t('console.handover.from')} <PersonName id={n.authorId} copy={false} /> · {formatClock(n.createdAt)}
        </p>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-text">{n.body}</p>
      </div>
      <Button variant="primary" size="sm" loading={ack.isPending} onClick={() => ack.mutate({ id: n.id })} needsNet>
        {t('console.handover.ack')}
      </Button>
    </section>
  );
}

/** «ملاحظة التسليم» in Today's header: the outgoing shift writes for the next one. */
export function HandoverWriteButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" icon={<IconNote size={15} />} onClick={() => setOpen(true)}>
        {t('console.handover.write')}
      </Button>
      {open ? <HandoverDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function HandoverDialog({ onClose }: { onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const id = useId();
  const [body, setBody] = useState('');
  const write = useMutation(
    trpc.onCall.handoverWrite.mutationOptions({
      onSuccess: (n) => {
        qc.setQueryData(trpc.onCall.handover.queryKey({ cityId: CITY_ID }), n);
        toast({ title: t('console.handover.saved') });
        onClose();
      },
      onError: (e) => toast({ title: t('console.today.failed', { message: errorText(e) }), tone: 'bad' }),
    }),
  );
  return (
    <Dialog open onClose={onClose} title={t('console.handover.write_title')} description={t('console.handover.write_hint')}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) write.mutate({ cityId: CITY_ID, body: body.trim() });
        }}
      >
        <Field label={t('console.handover.body')} htmlFor={id} hint={t('console.handover.body_hint')}>
          <Textarea id={id} rows={5} maxLength={HANDOVER_RULES.bodyMax} value={body} required onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('console.today.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={write.isPending} disabled={!body.trim()} needsNet>
            {t('console.handover.send')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
