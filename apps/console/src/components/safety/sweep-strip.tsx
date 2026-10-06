'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KHAT_RULES, SAFETY_DESK_ROLES, type KhatSweepAlert, type KhatSweepCloseReason, type PinAlertView } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useEffect, useId, useRef, useState } from 'react';
import { CITY_ID, queryRetry } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { SAFETY_POLL_MS } from '@/lib/safety-live';
import { useSignedIn } from '@/lib/session';
import { pinAlertDetail, pinAlertOrder, pinAlertTitle, pinAttemptLine, pinDriverName } from '@/lib/pin-alert';
import { sweepDetail, sweepDriverName, sweepOrder, sweepTitle } from '@/lib/sweep';
import { useTRPC } from '@/lib/trpc';
import { withBdi } from './bdi';
import { Button, cx, Dialog, Field, IconAlert, IconCheckCircle, IconPhone, Textarea, useNow, useToast } from '../ui';

const NONE: KhatSweepAlert[] = [];
const NO_PIN: PinAlertView[] = [];

/** The city's sweep alerts for the roles that answer safety items (polled like the SOS banner). */
export function useSweepAlerts() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const { roles, loaded } = useMyRoles();
  const allowed = loaded && hasAny(roles, SAFETY_DESK_ROLES);
  const q = useQuery(trpc.khat.sweepAlerts.queryOptions({ cityId: CITY_ID }, { enabled: signedIn && allowed, refetchInterval: SAFETY_POLL_MS, retry: queryRetry }));
  return { rows: q.data ?? NONE, allowed };
}

/** The city's الرجعة seat-PIN alerts (Ali 2026-10-06), polled with the sweep rows for the same roles. */
export function usePinAlerts() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const { roles, loaded } = useMyRoles();
  const allowed = loaded && hasAny(roles, SAFETY_DESK_ROLES);
  const q = useQuery(trpc.routes.ops.pinAlerts.queryOptions({ cityId: CITY_ID }, { enabled: signedIn && allowed, refetchInterval: SAFETY_POLL_MS, retry: queryRetry }));
  return { rows: q.data ?? NO_PIN, allowed };
}

/**
 * The ops alert strip under the SOS banner on every page (one place for the rows that need a
 * dispatcher now), in this order:
 * - خطوط "car is empty" (partner S-6; Ali 2026-10-06): a run ended `KHAT_RULES.sweepAlertAfterMin` ago
 *   and the driver has not confirmed nobody is left in the car; it calls him through the masked line
 *   and turns calm when he confirms late ("تأكد متأخر 7 دقيقة"), leaving after `sweepClearedShowMin`.
 *   A dispatcher can close an open one ("سكّر التنبيه") with a reason: it leaves the strip and the
 *   record keeps who, when and why (Ali, 2026-10-06);
 * - الرجعة seat PINs (Ali 2026-10-06): a rider's PIN typed on another rider's seat, or repeated wrong
 *   PINs on one seat, with the car's PIN history to unfold and the same masked call; each leaves after
 *   `PIN_ATTEMPT_RULES.alertShowMin`.
 * Its height is published as `--sweep-h` for full-height pages.
 */
export function SweepAlertStrip() {
  const { rows } = useSweepAlerts();
  const pins = usePinAlerts();
  const now = useNow(1000);
  const ordered = sweepOrder(rows);
  const openSweeps = ordered.filter((a) => !a.confirmedAt);
  const clearedSweeps = ordered.filter((a) => a.confirmedAt);
  const pinRows = pinAlertOrder(pins.rows);
  const count = ordered.length + pinRows.length;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!el) {
      root.style.setProperty('--sweep-h', '0px');
      return;
    }
    const set = () => root.style.setProperty('--sweep-h', `${el.offsetHeight}px`);
    set();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.setProperty('--sweep-h', '0px');
    };
  }, [count]);

  if (count === 0) return null;
  return (
    <section ref={ref} aria-label={t('console.safety.ops_alerts_region')} data-testid="sweep-strip" className="relative z-30 flex flex-col">
      {openSweeps.map((a) => (
        <SweepRow key={a.alertId} alert={a} now={now} />
      ))}
      {pinRows.map((a) => (
        <PinAlertRow key={a.alertId} alert={a} now={now} />
      ))}
      {clearedSweeps.map((a) => (
        <SweepRow key={a.alertId} alert={a} now={now} />
      ))}
    </section>
  );
}

function SweepRow({ alert, now }: { alert: KhatSweepAlert; now: number }) {
  const open = !alert.confirmedAt;
  return (
    <div
      role={open ? 'alert' : 'status'}
      data-testid={`sweep-alert-${alert.alertId}`}
      className={cx('flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 lg:px-6', open ? 'border-bad/50 bg-bad-tint text-bad' : 'border-line bg-ok-tint text-text')}
    >
      <span aria-hidden className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-pill', open ? 'bg-bad-solid text-on-bad' : 'bg-surface text-ok')}>
        {open ? <IconAlert size={20} /> : <IconCheckCircle size={20} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold leading-6">{withBdi(sweepTitle(alert))}</p>
        <p className={cx('num text-dense', open ? 'opacity-90' : 'text-muted')}>
          {withBdi(sweepDetail(alert, now))}
          {open ? ` · ${t('console.safety.sweep_reminded')}` : ''}
        </p>
      </div>
      {open ? (
        <div className="flex flex-wrap items-center gap-2">
          <SweepCallButton alert={alert} />
          <SweepCloseButton alert={alert} />
        </div>
      ) : null}
    </div>
  );
}

/** What a masked-call mutation answers with (`SafetyCallSession`). */
interface CallAnswer {
  mode: 'proxy' | 'dev_direct';
  dial: string;
}

/** The strip's call toasts: the number to dial (isolated, so "+964…" keeps its plus in front) and how. */
function useCallToasts(label: string) {
  const toast = useToast();
  return {
    onSuccess: (s: CallAnswer) =>
      toast({
        title: t('console.safety.call_dial', { number: `\u2066${s.dial}\u2069` }),
        body: s.mode === 'dev_direct' ? t('console.safety.call_dev') : t('console.safety.call_proxy'),
        action: { label, onClick: () => window.open(`tel:${s.dial}`, '_self') },
      }),
    onError: (e: { message: string }) => toast({ title: e.message, tone: 'bad' }),
  };
}

function SweepCallButton({ alert }: { alert: KhatSweepAlert }) {
  const trpc = useTRPC();
  const label = t('console.safety.call_raiser', { name: sweepDriverName(alert) });
  const call = useMutation(trpc.khat.callSweepDriver.mutationOptions(useCallToasts(label)));
  return (
    <Button variant="danger" size="lg" loading={call.isPending} icon={<IconPhone size={16} />} onClick={() => call.mutate({ alertId: alert.alertId })} data-testid={`sweep-call-${alert.alertId}`}>
      {label}
    </Button>
  );
}

const CLOSE_REASONS: readonly KhatSweepCloseReason[] = ['driver_called_empty', 'guardian_called', 'other'];

/** "سكّر التنبيه": the reason (and a short note for "غيرها"); audited on the server, idempotent. */
function SweepCloseButton({ alert }: { alert: KhatSweepAlert }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="lg" icon={<IconCheckCircle size={16} />} onClick={() => setOpen(true)} data-testid={`sweep-close-${alert.alertId}`}>
        {t('console.safety.sweep_close')}
      </Button>
      <SweepCloseDialog alert={alert} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function SweepCloseDialog({ alert, open, onClose }: { alert: KhatSweepAlert; open: boolean; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const noteId = useId();
  const [reason, setReason] = useState<KhatSweepCloseReason>('driver_called_empty');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setReason('driver_called_empty');
    setNote('');
    setTried(false);
  }, [open]);
  const close = useMutation(
    trpc.khat.closeSweepAlert.mutationOptions({
      onSuccess: (a) => {
        void qc.invalidateQueries(trpc.khat.sweepAlerts.pathFilter());
        // The driver confirmed first: nothing was closed, nothing is needed.
        toast(a.closedAt ? { title: t('console.safety.sweep_closed_done'), tone: 'ok' } : { title: t('console.safety.sweep_close_already') });
        onClose();
      },
      onError: (e) => toast({ title: e.message, tone: 'bad' }),
    }),
  );
  const trimmed = note.trim();
  const short = reason === 'other' && trimmed.length < KHAT_RULES.sweepCloseNoteMin;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="sm"
      labelledBy={`${noteId}-title`}
      title={t('console.safety.sweep_close_title', { name: sweepDriverName(alert) })}
      description={t('console.safety.sweep_close_body')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('console.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={close.isPending}
            onClick={() => {
              setTried(true);
              if (!short) close.mutate({ alertId: alert.alertId, reason, ...(trimmed ? { note: trimmed } : {}) });
            }}
            data-testid={`sweep-close-confirm-${alert.alertId}`}
          >
            {t('console.safety.sweep_close')}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-text">
        <fieldset className="grid gap-2">
          <legend className="sr-only">{t('console.safety.sweep_close')}</legend>
          {CLOSE_REASONS.map((r) => (
            <label key={r} className={cx('flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm', reason === r ? 'border-accent bg-accent-tint font-semibold' : 'border-line hover:bg-surface-2')}>
              <input type="radio" name={`sweep-reason-${alert.alertId}`} value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-[rgb(var(--c-accent))]" />
              {t(`console.safety.sweep_reason_${r}`)}
            </label>
          ))}
        </fieldset>
        <Field label={t('console.safety.sweep_close_note')} htmlFor={noteId} error={tried && short ? t('console.safety.sweep_close_note_short') : undefined}>
          <Textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('console.safety.sweep_close_note_placeholder')}
            rows={3}
            maxLength={KHAT_RULES.sweepCloseNoteMax}
            aria-invalid={tried && short}
            data-testid={`sweep-close-note-${alert.alertId}`}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/**
 * One الرجعة PIN alert: who typed whose PIN on which seat (or how many wrong ones), the car, a call to
 * the driver, and the car's whole PIN history to unfold (oldest first; the attempt that alerted marked).
 */
export function PinAlertRow({ alert, now }: { alert: PinAlertView; now: number }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const cross = alert.kind === 'cross_use';
  return (
    <div
      role={cross ? 'alert' : 'status'}
      data-testid={`pin-alert-${alert.alertId}`}
      className={cx('border-b px-4 py-2.5 lg:px-6', cross ? 'border-bad/50 bg-bad-tint text-bad' : 'border-warn-solid/40 bg-warn-tint text-warn')}
    >
      <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2">
        <span aria-hidden className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-pill', cross ? 'bg-bad-solid text-on-bad' : 'bg-warn-solid text-text')}>
          <IconAlert size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold leading-6">{withBdi(pinAlertTitle(alert))}</p>
          <p className="num text-dense opacity-90">{withBdi(pinAlertDetail(alert, now))}</p>
        </div>
        <Button variant="secondary" size="lg" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((v) => !v)} data-testid={`pin-history-${alert.alertId}`}>
          {open ? t('console.safety.pin_history_hide') : t('console.safety.pin_history_show', { n: alert.attempts.length })}
        </Button>
        <PinCallButton alert={alert} />
      </div>
      {open ? (
        <div id={listId} className="mt-2 rounded-lg border border-line bg-surface px-4 py-3 text-text">
          <p className="text-dense font-semibold text-muted">{t('console.safety.pin_history_title')}</p>
          <ol className="mt-1.5 flex flex-col gap-1" data-testid={`pin-history-list-${alert.alertId}`}>
            {alert.attempts.map((x) => (
              <li key={x.attemptId} className={cx('num flex flex-wrap items-center gap-x-2 text-dense', x.attemptId === alert.alertId && 'font-bold', x.result === 'checked_in' ? 'text-ok' : x.result === 'wrong_pin' ? 'text-text' : 'text-bad')}>
                <span>{withBdi(pinAttemptLine(x))}</span>
                {x.attemptId === alert.alertId ? <span className="rounded-pill bg-bad-solid px-2 text-xs font-semibold text-on-bad">{t('console.safety.pin_history_alert')}</span> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function PinCallButton({ alert }: { alert: PinAlertView }) {
  const trpc = useTRPC();
  const label = t('console.safety.call_raiser', { name: pinDriverName(alert) });
  const call = useMutation(trpc.routes.ops.callPinAlertDriver.mutationOptions(useCallToasts(label)));
  return (
    <Button variant={alert.kind === 'cross_use' ? 'danger' : 'secondary'} size="lg" loading={call.isPending} icon={<IconPhone size={16} />} onClick={() => call.mutate({ alertId: alert.alertId })} data-testid={`pin-call-${alert.alertId}`}>
      {label}
    </Button>
  );
}
