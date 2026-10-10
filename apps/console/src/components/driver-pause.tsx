'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DRIVER_PAUSE_RULES, type DriverPauseReason } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useId, useState } from 'react';
import { formatClock } from '@/lib/format';
import { hasAny, useMyRoles } from '@/lib/me';
import { errorText } from '@/lib/network';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { PersonName } from './named';
import { Button, Chip, cx, Dialog, Field, IconLock, Textarea, useToast } from './ui';

const PAUSERS = ['admin', 'dispatcher', 'support', 'field_ops'] as const;
const UNDO_MS = 10_000;

/**
 * Pause a courier or driver while a report is looked into (r6, Ali 2026-10-08), or lift it. Paused,
 * he can't go online (his app drops him within 30 s); a job he is on carries on. Both need a note
 * and are audited. Shown on a safety report (with its ticket) and on his book.
 */
export function DriverPause({
  personId,
  ticketId,
  reason = ticketId ? 'safety_report' : 'other',
  className,
}: {
  personId: string;
  ticketId?: string;
  reason?: DriverPauseReason;
  className?: string;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const signedIn = useSignedIn();
  const { roles } = useMyRoles();
  const can = hasAny(roles, [...PAUSERS]);
  const status = useQuery(trpc.driverAccount.pauseStatus.queryOptions({ personId }, { enabled: signedIn && can, retry: false, refetchInterval: 30_000 }));
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const noteId = useId();
  const done = (title: string) => {
    toast({ title, tone: 'ok' });
    setOpen(false);
    setNote('');
    void qc.invalidateQueries({ queryKey: trpc.driverAccount.pauseStatus.queryKey({ personId }) });
  };
  const onError = (e: unknown) => toast({ title: errorText(e as { message?: string }), tone: 'bad' });
  const lift = useMutation(trpc.driverAccount.liftPause.mutationOptions({ onSuccess: () => done(t('console.pause_lifted')), onError }));
  // o8: a pause can be taken back for 10 s; the undo is a lift with its own note, so both stay audited.
  const pause = useMutation(
    trpc.driverAccount.pause.mutationOptions({
      onSuccess: () => {
        setOpen(false);
        setNote('');
        void qc.invalidateQueries({ queryKey: trpc.driverAccount.pauseStatus.queryKey({ personId }) });
        toast({
          title: t('console.pause_done'),
          tone: 'ok',
          durationMs: UNDO_MS,
          action: { label: t('console.undo'), onClick: () => lift.mutate({ personId, note: t('console.pause_undo_note') }) },
        });
      },
      onError,
    }),
  );

  if (!can || !status.data) return null;
  const active = status.data.active;
  const short = note.trim().length < DRIVER_PAUSE_RULES.noteMin;
  const busy = pause.isPending || lift.isPending;
  return (
    <section
      aria-label={t('console.pause_title')}
      data-testid="driver-pause"
      className={cx(
        'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3',
        active ? 'border-bad-solid/50 bg-bad-tint' : 'border-line bg-surface',
        className,
      )}
    >
      <IconLock size={18} className={cx('shrink-0', active ? 'text-bad' : 'text-muted')} />
      <div className="min-w-0 flex-1">
        {active ? (
          <>
            <p className="flex flex-wrap items-center gap-2 font-semibold text-text">
              <Chip tone="bad" size="sm">
                {t('console.pause_chip')}
              </Chip>
              <PersonName id={personId} copy={false} strong />
              <span className="num">
                {active.pausedByName
                  ? t('console.pause_since_by', { time: formatClock(active.pausedAt), name: active.pausedByName })
                  : t('console.pause_since', { time: formatClock(active.pausedAt) })}
              </span>
            </p>
            <p className="mt-0.5 text-dense text-muted">«{active.note}»</p>
          </>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-x-1.5 font-semibold text-text">
              {t('console.pause_title')}
              <span aria-hidden className="text-faint">
                ·
              </span>
              <PersonName id={personId} copy={false} />
            </p>
            <p className="text-dense text-muted">{t('console.pause_hint')}</p>
          </>
        )}
      </div>
      <Button size="sm" variant={active ? 'secondary' : 'danger-soft'} onClick={() => setOpen(true)} needsNet data-testid={active ? 'pause-lift' : 'pause-open'}>
        {t(active ? 'console.pause_lift' : 'console.pause_go')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        width="sm"
        title={t(active ? 'console.pause_lift_title' : 'console.pause_dialog_title')}
        description={t(active ? 'console.pause_lift_body' : 'console.pause_dialog_body')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('console.cancel')}
            </Button>
            <Button
              variant={active ? 'primary' : 'danger'}
              loading={busy}
              disabled={short}
              needsNet
              data-testid="pause-confirm"
              onClick={() =>
                active
                  ? lift.mutate({ personId, note: note.trim() })
                  : pause.mutate({ personId, reason, note: note.trim(), ...(ticketId ? { ticketId } : {}) })
              }
            >
              {t(active ? 'console.pause_lift' : 'console.pause_go')}
            </Button>
          </>
        }
      >
        <div className="pb-2">
          <Field label={t('console.pause_note')} htmlFor={noteId} hint={t('console.pause_note_hint')}>
            <Textarea id={noteId} rows={3} maxLength={DRIVER_PAUSE_RULES.noteMax} value={note} required onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </section>
  );
}
