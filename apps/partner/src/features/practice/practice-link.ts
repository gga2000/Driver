import { TRPCClientError, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type { AppRouter } from '@driver/contracts';
import { arrive, asTrip, complete, respond, type PracticeState } from './scenario';

/**
 * The practice order's API (partner redesign l4): a tRPC link that answers the slip's and the job
 * screen's calls from the pretend order on this phone. Nothing is sent: a write the practice doesn't
 * know is refused here, and the only reads that reach the server are the harmless ones the screens
 * need to look right (`identity.me` and `partner.status`: his name, vehicle and position).
 */

export interface PracticeStore {
  get(): PracticeState | null;
  set(next: PracticeState): void;
}

/** Reads passed to the real API (read-only, no side effects). */
const FORWARD = new Set(['identity.me', 'partner.status']);

/** Calls the real client by path (`identity.me` → `client.identity.me.query(input)`). */
export type Forward = (path: string, input: unknown) => Promise<unknown>;

export function answerPractice(store: PracticeStore, path: string, input: unknown, now: number): unknown {
  const s = store.get();
  const body = (input ?? {}) as { accept?: boolean; stopId?: string; handover?: Record<string, unknown> };
  switch (path) {
    case 'partner.currentOffer':
      if (s?.stage !== 'offer' || !s.offer) return null;
      // Rung out: gone, like a real one (the slip re-reads this when its time is up).
      if (now > s.offer.expiresAt.getTime()) {
        store.set({ ...s, stage: 'idle', offer: null });
        return null;
      }
      return s.offer;
    case 'partner.activeJob':
      return s && (s.stage === 'job' || s.stage === 'done') ? s.job : null;
    case 'dispatch.offerSeen':
      return { ok: true };
    case 'dispatch.respond': {
      if (!s) throw practiceError('offer_expired');
      const next = respond(s, Boolean(body.accept), now);
      store.set(next);
      if (body.accept && next.stage !== 'job') throw practiceError('offer_expired');
      return { ok: true };
    }
    case 'trips.arrive':
      if (!s?.job) throw practiceError('not_found');
      store.set(arrive(s, String(body.stopId), now));
      return asTrip(store.get()!);
    case 'trips.completeStop':
      if (!s?.job) throw practiceError('not_found');
      store.set(complete(s, String(body.stopId), body.handover, now));
      return asTrip(store.get()!);
    case 'trips.reportPositions':
      return { armed: [] };
    case 'chat.threads':
      return [];
    // Reads with nothing to show in a practice: no road line, no zone question, no booked rides.
    case 'partner.offerRoute':
    case 'partner.jobRoute':
    case 'partner.zoneCheck':
      return null;
    default:
      // The photo upload and anything else that would write: refused, so it never leaves the phone.
      throw practiceError('practice');
  }
}

function practiceError(code: string): TRPCClientError<AppRouter> {
  const err = new TRPCClientError<AppRouter>(code);
  // The shape `apiErrorCode` reads (`data.code`), so the screens say the same kind words as for a real order.
  Object.assign(err, { data: { code } });
  return err;
}

export function practiceLink(store: PracticeStore, forward: Forward, clock: () => number = Date.now): TRPCLink<AppRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        // Live streams stay quiet: the practice never changes behind his back.
        if (op.type === 'subscription') return () => undefined;
        let closed = false;
        const run = async () => (op.type === 'query' && FORWARD.has(op.path) ? forward(op.path, op.input) : answerPractice(store, op.path, op.input, clock()));
        run().then(
          (data) => {
            if (closed) return;
            observer.next({ result: { type: 'data', data } });
            observer.complete();
          },
          (err: unknown) => {
            if (!closed) observer.error(err instanceof TRPCClientError ? err : TRPCClientError.from(err as Error));
          },
        );
        return () => {
          closed = true;
        };
      });
}
