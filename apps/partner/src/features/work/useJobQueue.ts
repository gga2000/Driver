import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Trip } from '@driver/contracts';
import { isNetworkError } from '@driver/contracts/net-client';
import { getNetwork, useToast } from '@driver/ui';
import { useApi, useApiClient } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useInPractice } from '@/features/practice/Practice';
import { storage } from '@/lib/storage';
import { createActionQueue, stampTap, type ActionQueue, type JobTap, type QueuedAction } from './offline-queue';

/**
 * The job-tap queue on this phone (see offline-queue.ts): one per app, persisted under
 * `driver.partner.job-queue`. `useJobQueueRunner` (root layout) replays it on start and whenever the
 * network comes back; screens use `useJobQueue().run(tap)`.
 */

const STORE_KEY = 'driver.partner.job-queue';
type Client = ReturnType<typeof useApiClient>;
let client: Client | null = null;

function send(c: Client, a: QueuedAction): Promise<Trip> {
  const stamp = { occurredAt: new Date(a.occurredAt), deviceUptimeMs: a.deviceUptimeMs, idempotencyKey: a.idempotencyKey };
  return a.kind === 'arrive'
    ? c.trips.arrive.mutate({ tripId: a.tripId, stopId: a.stopId, ...(a.pin ? { pin: a.pin } : {}), ...(a.accuracyM !== undefined ? { accuracyM: a.accuracyM } : {}), ...stamp })
    : c.trips.completeStop.mutate({ tripId: a.tripId, stopId: a.stopId, handover: a.handover, ...stamp });
}

const queue: ActionQueue = createActionQueue({
  store: { load: () => storage.getItem(STORE_KEY), save: (v) => (v === null ? storage.removeItem(STORE_KEY) : storage.setItem(STORE_KEY, v)) },
  sender: {
    send: (a) => {
      // No client yet (the runner mounts it): behave like a dead network so nothing is dropped.
      if (!client) return Promise.reject(new TypeError('Network request failed'));
      return send(client, a);
    },
  },
  isNetworkError,
});
const hydrated = queue.hydrate();

const subscribe = (cb: () => void) => queue.subscribe(cb);
const items = () => queue.items();
const sending = () => queue.sending();

export type TapResult = { status: 'sent'; trip: Trip } | { status: 'queued' };

/** Screens: the waiting taps and `run(tap)` — sent now when it can be, queued otherwise. */
export function useJobQueue() {
  const c = useApiClient();
  // l4: a practice tap is answered on this phone at once; it never joins the real queue.
  const practice = useInPractice();
  const list = useSyncExternalStore(subscribe, items, items);
  const isSending = useSyncExternalStore(subscribe, sending, sending);
  const run = useCallback(
    async (tap: JobTap): Promise<TapResult> => {
      if (practice) return { status: 'sent', trip: await send(c, stampTap(tap)) };
      await hydrated;
      const action = stampTap(tap);
      const online = getNetwork().getSnapshot().state === 'online';
      // Order matters: behind earlier waiting taps, this one waits its turn too.
      if (!online || queue.items().length > 0) {
        await queue.enqueue(action);
        if (online) void queue.flush();
        return { status: 'queued' };
      }
      try {
        return { status: 'sent', trip: await send(c, action) };
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        await queue.enqueue(action);
        return { status: 'queued' };
      }
    },
    [c, practice],
  );
  return practice ? { items: [], sending: false, run } : { items: list, sending: isSending, run };
}

/**
 * Mounted once (root layout, signed in): replays the queue on start and on every reconnect, then
 * re-reads the job. Says so: "انرسلت الخطوات المحفوظة", or that a step was refused.
 */
export function useJobQueueRunner(enabled: boolean) {
  const c = useApiClient();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const t = useT();

  useEffect(() => {
    if (!enabled) return;
    client = c;
    let alive = true;
    const flush = async () => {
      await hydrated;
      if (!alive || !queue.items().length || getNetwork().getSnapshot().state !== 'online') return;
      const res = await queue.flush();
      if (!alive) return;
      if (res.rejected.length) toast.show({ message: t('partner.queue_rejected_v2'), tone: 'danger' });
      else if (res.sent.length && !res.stalled) toast.show({ message: t('partner.queue_sent'), tone: 'success', icon: 'check' });
      if (res.sent.length || res.rejected.length) {
        await Promise.all([
          qc.invalidateQueries({ queryKey: api.partner.activeJob.queryKey() }),
          qc.invalidateQueries({ queryKey: api.partner.status.queryKey() }),
        ]);
      }
    };
    void flush();
    const net = getNetwork();
    let online = net.getSnapshot().state === 'online';
    const off = net.subscribe(() => {
      const now = net.getSnapshot().state === 'online';
      if (now && !online) void flush();
      online = now;
    });
    // A stalled replay (the network dropped again mid-way) retries on the next reconnect; this catches
    // a reconnect the device never reported.
    const id = setInterval(() => void flush(), 30_000);
    return () => {
      alive = false;
      off();
      clearInterval(id);
    };
  }, [enabled, c, api, qc, toast, t]);
}
