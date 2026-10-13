import { useEffect, useSyncExternalStore } from 'react';
import type { PartnerJob, PartnerJobStop } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { isNetworkError } from '@driver/contracts/net-client';
import { useNetwork } from '@driver/ui';
import { uploadPhoto, type PickedPhoto } from '@/features/account/photo';
import { useApiClient } from '@/lib/api';
import { storage } from '@/lib/storage';
import { receiptKey } from './logic';

/**
 * «الوصل» on this phone, outside the lazy list card: which shops stops have a receipt (sent, or waiting
 * for the network), so the job screen's main button knows before any server call. A receipt waiting
 * for the network counts as recorded (the courier is never stuck at the shop); the server's pickup
 * guard decides in the end. Plain module state + device storage, read synchronously.
 */

export interface SavedReceipt {
  receiptIqd: number;
  /** What he collects at the door, from the server; null while it waits for the network. */
  cashDueIqd: number | null;
}
interface Pending {
  tripId: string;
  stopId: string;
  totalIqd: number;
  photo: PickedPhoto;
}

const saved = new Map<string, SavedReceipt>();
const listeners = new Set<() => void>();
const nudges = new Set<() => void>();
let version = 0;
const changed = () => {
  version++;
  for (const l of listeners) l();
};

const key = receiptKey;
const pendingKey = (stopId: string) => `errand.receipt_pending.${stopId.replace(/[^\w.-]/g, '_')}`;
const PENDING_INDEX = 'errand.receipt_pending';

export function receiptOf(stopId: string): SavedReceipt | null {
  return saved.get(stopId) ?? null;
}

export function useReceipt(stopId: string): SavedReceipt | null {
  useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    () => version,
  );
  return receiptOf(stopId);
}

/** Reads what this phone kept for the stop (after a restart). */
export async function loadReceipt(stopId: string): Promise<void> {
  if (saved.has(stopId)) return;
  const raw = await storage.getItem(key(stopId)).catch(() => null);
  if (!raw) return;
  try {
    const v = JSON.parse(raw) as SavedReceipt;
    if (Number.isInteger(v.receiptIqd)) {
      saved.set(stopId, { receiptIqd: v.receiptIqd, cashDueIqd: Number.isInteger(v.cashDueIqd) ? v.cashDueIqd : null });
      changed();
    }
  } catch {
    /* unreadable: he records it again */
  }
}

function keep(stopId: string, r: SavedReceipt): void {
  saved.set(stopId, r);
  changed();
  void storage.setItem(key(stopId), JSON.stringify(r)).catch(() => undefined);
}

/** «غيّر»: the stop asks for a receipt again until a new one is sent. */
export function forgetReceipt(stopId: string): void {
  saved.delete(stopId);
  changed();
  void storage.removeItem(key(stopId)).catch(() => undefined);
}

type Client = ReturnType<typeof useApiClient>;

async function send(client: Client, p: Pending): Promise<SavedReceipt> {
  const photoUploadId = await uploadPhoto(p.photo, (input) => client.places.photoUpload.mutate(input));
  const res = await client.partner.errandReceipt.mutate({ tripId: p.tripId, stopId: p.stopId, totalIqd: p.totalIqd, photoUploadId });
  return { receiptIqd: res.receiptIqd, cashDueIqd: res.cashDueIqd };
}

async function pendingIds(): Promise<string[]> {
  const raw = await storage.getItem(PENDING_INDEX).catch(() => null);
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function setPending(stopId: string, p: Pending | null): Promise<void> {
  const ids = new Set(await pendingIds());
  if (p) {
    ids.add(stopId);
    await storage.setItem(pendingKey(stopId), JSON.stringify(p)).catch(() => undefined);
  } else {
    ids.delete(stopId);
    await storage.removeItem(pendingKey(stopId)).catch(() => undefined);
  }
  await storage.setItem(PENDING_INDEX, JSON.stringify([...ids])).catch(() => undefined);
}

/**
 * Sends the receipt now; with no network it waits on this phone (and counts as recorded) until
 * `useReceiptRetry` sends it. A refusal from the server (not the network) is thrown to the panel.
 */
export async function recordReceipt(client: Client, p: Pending): Promise<'sent' | 'queued'> {
  try {
    keep(p.stopId, await send(client, p));
    await setPending(p.stopId, null);
    return 'sent';
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    keep(p.stopId, { receiptIqd: p.totalIqd, cashDueIqd: null });
    await setPending(p.stopId, p);
    return 'queued';
  }
}

/**
 * Mounted with the job screen's kind slot: reads this stop's receipt from the phone (so the main button
 * knows after a restart) and sends receipts that waited for the network once it is back.
 */
export function useReceiptRetry(stopId: string | null): void {
  const client = useApiClient();
  const net = useNetwork();
  useEffect(() => {
    if (stopId) void loadReceipt(stopId);
  }, [stopId]);
  useEffect(() => {
    if (!net.online) return;
    void (async () => {
      for (const stopId of await pendingIds()) {
        const raw = await storage.getItem(pendingKey(stopId)).catch(() => null);
        if (!raw) {
          await setPending(stopId, null);
          continue;
        }
        try {
          const p = JSON.parse(raw) as Pending;
          keep(stopId, await send(client, p));
          await setPending(stopId, null);
        } catch (e) {
          // Still offline: try at the next reconnect. Refused (left the shops, photo gone): drop it so
          // the stop asks again or support settles it (docs/api/errand-receipt.md).
          if (!isNetworkError(e)) {
            await setPending(stopId, null);
            forgetReceipt(stopId);
          }
        }
      }
    })();
  }, [net.online, client]);
}

/** The job screen's main button asks the panel to show itself (once per tap). */
export function nudgeReceipt(): void {
  for (const n of nudges) n();
}
export function onReceiptNudge(cb: () => void): () => void {
  nudges.add(cb);
  return () => void nudges.delete(cb);
}

/**
 * Before «اشتريت الليستة» on a دوّرلي shops stop: the message key when no receipt is recorded or
 * waiting on this phone, else null. Null for every other job and stop.
 */
export function errandBlocks(job: Pick<PartnerJob, 'vertical'>, stop: Pick<PartnerJobStop, 'stopId' | 'type' | 'state' | 'shopList'> | null): MessageKey | null {
  if (job.vertical !== 'errand' || !stop || stop.type !== 'pickup' || stop.state !== 'arrived' || !stop.shopList) return null;
  return saved.has(stop.stopId) ? null : 'partner.errand.receipt_first';
}
