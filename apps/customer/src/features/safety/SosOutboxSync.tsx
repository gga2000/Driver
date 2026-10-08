import { useEffect, useSyncExternalStore } from 'react';
import type { SosSubject } from '@driver/contracts';
import { getNetwork } from '@driver/ui';
import { useApiClient } from '@/lib/api';
import { session } from '@/lib/session';
import { currentSosFix } from './fix';
import { sosOutbox } from './outbox';
import { SosModal } from './SosControl';
import { useSos } from './useSos';

/**
 * Mounted once at the root: gives the SOS outbox its sender, sends a press saved before the app was
 * closed, and shows how that one ended (the incident with its cancel, or "call 911") wherever the
 * person is. Presses made on a trip screen are shown by that screen.
 */
export function SosOutboxSync() {
  const client = useApiClient();
  useEffect(() => {
    sosOutbox.setDeps({
      send: (input) => client.safety.sos.mutate(input),
      fix: () => currentSosFix(2500),
      online: () => getNetwork().getSnapshot().state === 'online',
      signedIn: () => Boolean(session.getSnapshot().session),
    });
    void sosOutbox.restore();
  }, [client]);
  const box = useSyncExternalStore(sosOutbox.subscribe, sosOutbox.getState, sosOutbox.getState);
  const subject: SosSubject | null = box.press?.restored ? box.press.subject : (box.delivered?.restored ? subjectOf(box.delivered.subjectKey) : box.refused?.restored ? subjectOf(box.refused.subjectKey) : null);
  const sos = useSos(subject, { launch: true });
  return subject ? <SosModal sos={sos} /> : null;
}

function subjectOf(key: string): SosSubject {
  const at = key.indexOf(':');
  return { kind: key.slice(0, at), id: key.slice(at + 1) } as SosSubject;
}
