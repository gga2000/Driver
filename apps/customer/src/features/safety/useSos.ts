import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Linking } from 'react-native';
import { SAFETY_RULES, type SosSubject, type SosView } from '@driver/contracts';
import { getNetwork, useToast, type SosSheetPhase } from '@driver/ui';
import { useApiClient } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { currentSosFix } from './fix';
import { createSosOutbox, subjectKey } from './sos-outbox';

/**
 * The app's one SOS outbox (FLOW-05): a press that hasn't got through keeps trying after the sheet is
 * closed or the trip screen left, and tries at once when the network or the app comes back.
 */
const outbox = createSosOutbox();
getNetwork().subscribe(() => {
  if (getNetwork().getSnapshot().state === 'online') outbox.nudge();
});
AppState.addEventListener('change', (s) => {
  if (s === 'active') outbox.nudge();
});

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
export function useSos(subject: SosSubject | null) {
  const client = useApiClient();
  const toast = useToast();
  const t = useT();
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
    else setPhase((cur) => (cur && cur !== 'sending' && cur !== 'failed' && cur !== 'offline' ? sosPhaseOf(v) : cur));
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

  useEffect(() => {
    outbox.setDeps({
      send: (input) => client.safety.sos.mutate(input),
      fix: () => currentSosFix(2500),
      online: () => getNetwork().getSnapshot().state === 'online',
    });
  }, [client]);

  // The press got through (now or after the sheet was closed): show the incident and its cancel.
  const delivered = box.delivered;
  const seen = useRef<SosView | null>(null);
  useEffect(() => {
    if (!delivered || delivered.subjectKey !== key || seen.current === delivered.view) return;
    seen.current = delivered.view;
    accept(delivered.view, true);
  }, [delivered, key, accept]);

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

  const cancel = useCallback(async () => {
    if (!view || cancelling) return;
    setCancelling(true);
    try {
      accept(await client.safety.cancel.mutate({ incidentId: view.incidentId }), true);
      toast.show({ message: t('sos.cancelled'), tone: 'info', icon: 'check' });
    } catch {
      toast.show({ message: t('sos.cancel_late'), tone: 'warning', icon: 'sos' }, 5000);
    } finally {
      setCancelling(false);
    }
  }, [view, cancelling, client, accept, toast, t]);

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
