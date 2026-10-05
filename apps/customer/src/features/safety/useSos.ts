import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { SAFETY_RULES, type SosSubject, type SosView } from '@driver/contracts';
import { useNetwork, useToast, type SosSheetPhase } from '@driver/ui';
import { useApiClient } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { currentSosFix } from './fix';

const RETRY_MS = 4_000;

export function sosPhaseOf(v: Pick<SosView, 'state'>): SosSheetPhase {
  return v.state === 'open' ? 'open' : v.state === 'acknowledged' ? 'acknowledged' : v.state === 'resolved' ? 'resolved' : 'cancelled';
}

const newClientId = () => `sos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * The SOS flow on a trip screen (scoring & safety §3): the hold sends `safety.sos` with the phone's
 * fix (retried every few seconds while the network is down — the press keeps its client id, so a
 * retry is the same incident); the sheet shows the 10-s cancel; while the incident is open the
 * phone sends its position every 5 s and picks up who took it. An open incident survives a
 * restart of the screen (`safety.status`).
 */
export function useSos(subject: SosSubject | null) {
  const client = useApiClient();
  const toast = useToast();
  const t = useT();
  const net = useNetwork();
  const online = useRef(net.online);
  online.current = net.online;
  const [view, setView] = useState<SosView | null>(null);
  const [phase, setPhase] = useState<SosSheetPhase | null>(null);
  const [cancelling, setCancelling] = useState(false);
  /** Server clock − device clock, so the cancel countdown follows the server's window. */
  const [offset, setOffset] = useState(0);
  const pending = useRef<{ clientId: string; pressedAt: Date } | null>(null);
  const key = subject ? `${subject.kind}:${subject.id}` : null;

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

  const send = useCallback(async () => {
    const press = pending.current;
    if (!press || !subject) return;
    const position = await currentSosFix(2500);
    try {
      const v = await client.safety.sos.mutate({ subject, position, clientId: press.clientId, pressedAt: press.pressedAt });
      pending.current = null;
      accept(v, true);
    } catch {
      if (pending.current === press) setPhase(online.current ? 'failed' : 'offline');
    }
  }, [client, subject, accept]);

  const trigger = useCallback(() => {
    pending.current = { clientId: newClientId(), pressedAt: new Date() };
    setPhase('sending');
    void send();
  }, [send]);

  // Not through yet: keep trying while the sheet says so.
  useEffect(() => {
    if (phase !== 'offline' && phase !== 'failed') return;
    const id = setInterval(() => void send(), RETRY_MS);
    return () => clearInterval(id);
  }, [phase, send]);

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
    active: sharing,
    phase,
    view,
    cancelling,
    cancelUntil: view ? view.cancelUntil.getTime() - offset : null,
    trigger,
    retry: () => void send(),
    release: () => toast.show({ message: t('sos.released'), tone: 'info', icon: 'sos' }),
    cancel: () => void cancel(),
    close: () => setPhase(null),
    open: () => view && setPhase(sosPhaseOf(view)),
    callPolice: () => void Linking.openURL(`tel:${SAFETY_RULES.policeNumber}`).catch(() => undefined),
  };
}
