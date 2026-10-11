'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Trip } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { errorText } from '@/lib/network';
import { useTRPC } from '@/lib/trpc';
import { Button, Dialog, Textarea, useToast } from '../ui';

/** The courier still has the job and nothing is picked up yet: the desk may take it off him. */
export function canTakeOff(trip: Pick<Trip, 'courierId' | 'state' | 'stops'> | null | undefined): boolean {
  if (!trip?.courierId) return false;
  if (!['accepted', 'en_route_to_pickup', 'arrived_pickup'].includes(trip.state)) return false;
  return !trip.stops.some((s) => (s.type === 'pickup' || s.type === 'shop') && s.state === 'completed');
}

/**
 * «شيل الطلب منه»: a stalled courier's job goes back to dispatch before pickup (`trips.cancel` as the
 * platform, with the reason in the Console audit log). Dispatch offers it again at once and the desk can
 * still send it to the courier it picks; he hears it was taken off him.
 */
export function TakeOffDialog({ tripId, title, onClose }: { tripId: string | null; title: string; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const id = useId();
  const [reason, setReason] = useState('');
  const takeOff = useMutation(
    trpc.trips.cancel.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: trpc.dispatch.board.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.trips.get.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.orders.events.queryKey() });
        toast({ title: t('console.take_off_done'), tone: 'ok' });
        onClose();
      },
    }),
  );
  useEffect(() => {
    setReason('');
    takeOff.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when another job opens
  }, [tripId]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (tripId && reason.trim()) takeOff.mutate({ tripId, reason: reason.trim() });
  };
  return (
    <Dialog
      open={tripId !== null}
      onClose={onClose}
      width="sm"
      title={t('console.take_off_title')}
      description={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('console.cancel')}
          </Button>
          <Button variant="danger" type="submit" needsNet form={`${id}-f`} loading={takeOff.isPending} disabled={!reason.trim()}>
            {t('console.take_off_submit')}
          </Button>
        </>
      }
    >
      <form id={`${id}-f`} onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted">{t('console.take_off_body')}</p>
        <div>
          <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
            {t('console.take_off_reason')}
          </label>
          <Textarea id={id} rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus aria-describedby={`${id}-hint`} />
          <p id={`${id}-hint`} className="mt-1 text-xs text-faint">
            {t('console.take_off_reason_hint')}
          </p>
        </div>
        <div role="status" className="min-h-5 text-sm">
          {takeOff.error ? <p className="text-bad">{errorText(takeOff.error)}</p> : null}
        </div>
      </form>
    </Dialog>
  );
}
