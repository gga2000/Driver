'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BoardCard } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useEffect, useId, useState, type FormEvent } from 'react';
import type { Blocker, Candidate } from '@/lib/dispatch';
import { orderLabel, personText, useNames } from '@/lib/names';
import { errorText } from '@/lib/network';
import { verticalLabel, zoneName } from '@/lib/labels';
import { useTRPC } from '@/lib/trpc';
import { Button, Checkbox, Dialog, Input, Textarea } from '../ui';

/** `dispatch.override`: offers the trip to one driver (he still accepts or declines). */
export function useOverride() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  return useMutation(
    trpc.dispatch.override.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: trpc.dispatch.board.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.dispatch.drivers.queryKey() });
      },
    }),
  );
}

export const BLOCKER_KEY: Record<Blocker, MessageKey> = {
  over_cap: 'console.blocker_over_cap',
  offline: 'console.blocker_offline',
  vehicle: 'console.blocker_vehicle',
};

/** What a card is called in a sentence: "#2009 · أكل · شارع 30". */
export function cardTitle(card: BoardCard, orderIds: readonly string[]): string {
  return [orderIds.map(orderLabel).join(' '), verticalLabel(card.vertical), zoneName(card.zoneId)].filter(Boolean).join(' · ');
}

/**
 * A candidate the server would refuse without "force" (over the cap, offline, wrong vehicle): say
 * why in words and ask for the reason before sending (review J116: forced assigns carry a reason).
 */
export function ForceDialog({
  target,
  name,
  title,
  busy,
  error,
  onSend,
  onClose,
}: {
  target: Candidate | null;
  name: string;
  title: string;
  busy: boolean;
  error: unknown;
  onSend: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const id = useId();
  useEffect(() => setReason(''), [target]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim()) onSend(reason.trim());
  };
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={t('console.force_title', { name })}
      description={title}
      labelledBy="force-title"
      footer={
        <>
          <Button onClick={onClose}>{t('console.cancel')}</Button>
          <Button variant="danger" type="submit" form={`${id}-f`} loading={busy} disabled={!reason.trim()}>
            {t('console.force_submit', { name })}
          </Button>
        </>
      }
    >
      {target ? (
        <form id={`${id}-f`} onSubmit={submit} className="space-y-3">
          <ul className="space-y-1 text-sm">
            {target.blockers.map((b) => (
              <li key={b} className="flex items-center gap-2 text-bad">
                <span aria-hidden className="h-1.5 w-1.5 rounded-pill bg-bad-solid" />
                {t(BLOCKER_KEY[b])}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">{t('console.force_hint')}</p>
          <label htmlFor={id} className="block text-sm font-medium">
            {t('console.override_reason')}
          </label>
          <Textarea id={id} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus aria-invalid={false} />
          {error ? <p className="text-sm text-bad">{errorText(error as Parameters<typeof errorText>[0])}</p> : null}
        </form>
      ) : null}
    </Dialog>
  );
}

/** Someone outside the top five: pick any online driver by name (or paste an id). */
export function OtherDriverDialog({
  card,
  title,
  drivers,
  onClose,
  onSent,
}: {
  card: BoardCard | null;
  title: string;
  drivers: readonly string[];
  onClose: () => void;
  onSent: (driverId: string) => void;
}) {
  const ids = { driver: useId(), reason: useId(), list: useId() };
  const [driverId, setDriverId] = useState('');
  const [reason, setReason] = useState('');
  const [force, setForce] = useState(false);
  const names = useNames({ people: drivers });
  const override = useOverride();

  useEffect(() => {
    if (!card) return;
    setDriverId('');
    setReason('');
    setForce(false);
    override.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the card changes
  }, [card]);

  const needsReason = force && reason.trim().length === 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!card || !driverId.trim() || needsReason) return;
    override.mutate(
      { tripId: card.tripId, driverId: driverId.trim(), ...(reason.trim() ? { reason: reason.trim() } : {}), ...(force ? { force: true } : {}) },
      { onSuccess: () => onSent(driverId.trim()) },
    );
  };

  return (
    <Dialog
      open={card !== null}
      onClose={onClose}
      title={t('console.override_title')}
      description={title}
      labelledBy="other-title"
      footer={
        <>
          <Button onClick={onClose}>{t('console.cancel')}</Button>
          <Button variant="primary" type="submit" form={`${ids.driver}-f`} loading={override.isPending} disabled={!driverId.trim() || needsReason}>
            {t('console.override_submit')}
          </Button>
        </>
      }
    >
      <form id={`${ids.driver}-f`} onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor={ids.driver} className="mb-1.5 block text-sm text-muted">
            {t('console.override_driver_name')}
          </label>
          <Input id={ids.driver} required list={ids.list} value={driverId} onChange={(e) => setDriverId(e.target.value)} autoComplete="off" autoFocus />
          <datalist id={ids.list}>
            {drivers.map((d) => (
              <option key={d} value={d} label={personText(d, names.person(d), { vehicle: true }) ?? d} />
            ))}
          </datalist>
        </div>
        <div>
          <label htmlFor={ids.reason} className="mb-1.5 block text-sm text-muted">
            {t('console.override_reason')}
          </label>
          <Textarea id={ids.reason} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={needsReason} aria-describedby={`${ids.reason}-hint`} />
          <p id={`${ids.reason}-hint`} className={`mt-1 text-xs ${needsReason ? 'text-bad' : 'text-faint'}`}>
            {t('console.override_reason_hint')}
          </p>
        </div>
        <Checkbox label={t('console.override_force')} checked={force} onChange={setForce} />
        <div role="status" className="min-h-5 text-sm">
          {override.error ? <p className="text-bad">{errorText(override.error)}</p> : null}
        </div>
      </form>
    </Dialog>
  );
}
