import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Linking } from 'react-native';
import { SAFETY_RULES, type SosSubject, type SosView } from '@driver/contracts';
import { useToast, type SosSheetPhase } from '@driver/ui';
import { apiErrorCode, apiErrorMessage, useApiClient } from '@/lib/api';
import { classifyError } from '@/lib/errors';
import { useLocale, useT } from '@/lib/i18n';
import { currentSosFix } from './fix';
import { sosOutbox as outbox } from './outbox';
import { subjectKey } from './sos-outbox';

export function sosPhaseOf(v: Pick<SosView, 'state'>): SosSheetPhase {
  return v.state === 'open' ? 'open' : v.state === 'acknowledged' ? 'acknowledged' : v.state === 'resolved' ? 'resolved' : 'cancelled';
}

/**
 * The SOS flow on a trip screen (scoring & safety §3): the hold sends `safety.sos` with the phone's
 * fix through the app's outbox (retried every few seconds until it gets through, even with the sheet
 * closed — the press keeps its client id, so a retry is the same incident); the sheet shows the 10-s
 * cancel; while the incident is open the phone sends its position every 5 s and picks up who took
 * it. An open incident survives a restart of the screen (`safety.status`); a press still on its way
 * keeps the button lit, and tapping it shows the sheet again.
 */
export function useSos(subject: SosSubject | null, opts: { launch?: boolean } = {}) {
  /** The root's instance shows only presses restored at launch; a trip screen's, only its own. */
  const launch = Boolean(opts.launch);
  const client = useApiClient();
  const toast = useToast();
  const t = useT();
  const locale = useLocale();
  const [view, setView] = useState<SosView | null>(null);
  const [phase, setPhase] = useState<SosSheetPhase | null>(null);
  const [cancelling, setCancelling] = useState(false);
  /** Server clock − device clock, so the cancel countdown follows the server's window. */
  const [offset, setOffset] = useState(0);
  const key = subject ? subjectKey(subject) : null;
  const box = useSyncExternalStore(outbox.subscribe, outbox.getState, outbox.getState);
  const pending = Boolean(box.press && key && subjectKey(box.press.subject) === key);

  const accept = useCallback((v: SosView, openSheet: boolean) => {
    setView(v);
    setOffset(v.serverNow.getTime() - Date.now());
    if (openSheet) setPhase(sosPhaseOf(v));
    else setPhase((cur) => (cur && cur !== 'sending' && cur !== 'failed' && cur !== 'offline' && cur !== 'final' ? sosPhaseOf(v) : cur));
  }, []);

  // An alert already open (the screen was reopened): the button shows it, no new hold needed.
  useEffect(() => {
    if (!key) return;
    let alive = true;
    client.safety.status
      .query({})
      .then((v) => {
        if (alive && v?.sharing) accept(v, false);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key, client, accept]);

  // The press got through (now, after the sheet was closed, or after a relaunch): show the incident and
  // its cancel. A press restored at launch is shown by the root; a trip screen just lights its button.
  const delivered = box.delivered;
  const seen = useRef<SosView | null>(null);
  useEffect(() => {
    if (!delivered || delivered.subjectKey !== key || seen.current === delivered.view) return;
    seen.current = delivered.view;
    accept(delivered.view, delivered.restored === launch);
  }, [delivered, key, accept, launch]);

  // Refused for good (a retry can't help): the sheet opens on "call 911" (audit FLOW-05 review).
  const refused = box.refused;
  const seenRefused = useRef<typeof refused>(null);
  useEffect(() => {
    if (!refused || refused.subjectKey !== key || refused.restored !== launch || seenRefused.current === refused) return;
    seenRefused.current = refused;
    setPhase('final');
  }, [refused, key, launch]);

  // At launch, a press saved before the app was closed: the sheet says it is being sent again.
  const restoredPress = launch && box.press?.restored ? box.press : null;
  useEffect(() => {
    if (restoredPress) setPhase((cur) => cur ?? 'sending');
  }, [restoredPress]);

  // Not through yet: the open sheet says why (the outbox keeps trying either way).
  useEffect(() => {
    if (!pending || !box.failure) return;
    const failure = box.failure;
    setPhase((cur) => (cur === null ? null : failure));
  }, [pending, box.failure]);

  const trigger = useCallback(() => {
    if (!subject) return;
    setPhase('sending');
    outbox.press(subject);
  }, [subject]);

  // Open: the position every 5 s (or a status read when there is no fix).
  const incidentId = view?.incidentId ?? null;
  const sharing = Boolean(view?.sharing);
  useEffect(() => {
    if (!incidentId || !sharing) return;
    const id = setInterval(() => {
      void (async () => {
        const fix = await currentSosFix(3000);
        try {
          const v = fix ? await client.safety.position.mutate({ incidentId, position: fix }) : await client.safety.status.query({ incidentId });
          if (v) accept(v, false);
        } catch {
          // The next tick tries again; the Console keeps the last fix it has.
        }
      })();
    }, SAFETY_RULES.positionEverySec * 1000);
    return () => clearInterval(id);
  }, [incidentId, sharing, client, accept]);

  const cancel = useCallback(async function run(): Promise<void> {
    if (!view || cancelling) return;
    setCancelling(true);
    try {
      accept(await client.safety.cancel.mutate({ incidentId: view.incidentId }), true);
      toast.show({ message: t('sos.cancelled'), tone: 'info', icon: 'check' });
    } catch (err) {
      // Only the server's "the window has passed" is too late; a lost answer leaves the alert on and
      // says so, with a retry while the window is still open (audit FLOW-09).
      if (classifyError(err).transient) {
        toast.show({ message: t('sos.cancel_failed'), tone: 'warning', icon: 'sos', action: { label: t('action.retry'), onPress: () => void run() } }, 5000);
      } else {
        toast.show({ message: apiErrorCode(err) === 'sos_cancel_window_passed' ? t('sos.cancel_late') : apiErrorMessage(err, t('sos.cancel_late'), locale), tone: 'warning', icon: 'sos' }, 5000);
      }
    } finally {
      setCancelling(false);
    }
  }, [view, cancelling, client, accept, toast, t, locale]);

  return {
    // A press still on its way keeps the button lit too, so the person can reopen the sheet.
    active: sharing || pending,
    phase,
    view,
    cancelling,
    cancelUntil: view ? view.cancelUntil.getTime() - offset : null,
    trigger,
    retry: () => outbox.nudge(),
    release: () => toast.show({ message: t('sos.released'), tone: 'info', icon: 'sos' }),
    cancel: () => void cancel(),
    close: () => setPhase(null),
    open: () => {
      if (pending) setPhase(box.failure ?? 'sending');
      else if (view) setPhase(sosPhaseOf(view));
    },
    callPolice: () => void Linking.openURL(`tel:${SAFETY_RULES.policeNumber}`).catch(() => undefined),
  };
}
