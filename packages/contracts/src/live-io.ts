import { z } from 'zod';
import type { SessionClaims } from './auth.js';
import { ChatThreadKind } from './chat-io.js';
import { CityId, LatLng } from './common.js';
import type { Actor } from './identity-io.js';
import { OrderState } from './order.js';
import { SharedTrip } from './share-io.js';
import { EtaBasis } from './tracking.js';

/**
 * The real-time channel (tRPC v11 subscriptions over SSE, `live.*`). It replaces the apps' fast
 * polling: the server pushes compact events — "these queries changed" (`invalidate`) or a minimal
 * patch (`position`, `order_state`, `new_order`, `chat`) — and the client patches or invalidates
 * its React Query cache. The data itself is always re-read through the ordinary queries, with the
 * same auth and scoping, so a lost event costs freshness, never correctness.
 *
 * Fan-out: outbox subscribers publish to a channel per order / driver / merchant / chat thread /
 * city (Redis pub/sub across API instances; in memory without REDIS_URL). Each `live.*`
 * subscription listens to its own channel(s) only; who may open which channel is checked on
 * connect, re-checked every `recheckMs`, and the stream ends when the session token expires.
 *
 * Auth: EventSource cannot send headers, so the client first calls `live.token` (a normal
 * Bearer-authenticated mutation) for a short-lived signed stream token and opens the stream with it
 * in tRPC `connectionParams` (`?connectionParams={"streamToken":"…"}`). The stream token is good
 * for the live router only (its own audience), never as an access token, and expires with the
 * session's access token, at most `streamTokenTtlSec` after issue.
 */

export const LIVE_RULES = {
  /** A courier's position goes out at most this often per order (and per driver pin). */
  positionThrottleMs: 2_000,
  /** Scoping (role, store, order party) and the session are re-checked this often on an open stream. */
  recheckMs: 30_000,
  /** Server keep-alive comment: proxies that cut idle connections at 30–60 s see traffic. */
  pingMs: 15_000,
  /** Clients reconnect when nothing (not even a ping) arrived for this long. */
  inactivityMs: 45_000,
  /** Stream tokens live at most this long (and never past the access token they were minted with). */
  streamTokenTtlSec: 15 * 60,
  /** Clients: no `hello` this long after opening = the network/proxy buffers SSE; treat as a failure. */
  connectTimeoutMs: 12_000,
  /** Reconnect backoff: base × 2^(n−1), capped, ±20 % jitter. */
  backoffBaseMs: 1_000,
  backoffMaxMs: 30_000,
  /** Consecutive failed attempts before the client falls back to slow polling (it keeps retrying). */
  failuresBeforeFallback: 3,
  /** Slow polling while SSE is not working (some Iraqi networks / proxies buffer or block it). */
  fallbackPollMs: 30_000,
  /** Safety refetch while the stream is live: catches anything an event did not cover. */
  safetyPollMs: 60_000,
} as const;

/**
 * The client-side query an `invalidate` event names. Clients map each to their React Query key
 * (with the ids the event or the hook carries).
 */
export const LiveKey = z.enum([
  'orders.track',
  'orders.courierPosition',
  'orders.mine',
  'orders.listActive',
  'chat.threads',
  'chat.thread',
  'partner.status',
  'partner.currentOffer',
  'partner.activeJob',
  'merchant.board',
  'merchant.storeStatus',
  'dispatch.board',
  'dispatch.drivers',
  'trips.board',
  'console.rightNow',
  /** SOS incidents (`safety.list` / `safety.get`): the Console's red banner and incident desk. */
  'safety.open',
]);
export type LiveKey = z.infer<typeof LiveKey>;

const LiveIds = {
  orderId: z.string().optional(),
  tripId: z.string().optional(),
};

/** First event of every (re)connection: the stream is authorised and listening; clients resync. */
export const LiveHello = z.object({
  type: z.literal('hello'),
  channels: z.array(z.string()),
  serverNow: z.coerce.date(),
});
/** "Re-read these queries": the cause is the domain event type (`order.accepted`, `dispatch.offer_sent`…). */
export const LiveInvalidate = z.object({
  type: z.literal('invalidate'),
  keys: z.array(LiveKey).min(1),
  cause: z.string(),
  ...LiveIds,
});
/** The order moved (`orders.track`'s `order.state`); clients patch the cached view and re-read it. */
export const LiveOrderState = z.object({
  type: z.literal('order_state'),
  orderId: z.string(),
  state: OrderState,
  cause: z.string(),
});
/** The courier's fix for one order, only inside the sharing window (accept → this customer's drop-off). */
export const LivePosition = z.object({
  type: z.literal('position'),
  orderId: z.string(),
  tripId: z.string(),
  pin: LatLng,
  bearing: z.number().nullable(),
  speedKmh: z.number().nullable(),
  at: z.coerce.date(),
  /** The server's ETA for this customer's next step (maps program SP4b); absent from older servers. */
  etaAt: z.coerce.date().nullable().optional(),
  etaBasis: EtaBasis.nullable().optional(),
});
/** A driver pin moved (Console board). */
export const LiveDriverPin = z.object({
  type: z.literal('driver_pin'),
  driverId: z.string(),
  tripId: z.string().nullable(),
  pin: LatLng,
  at: z.coerce.date(),
});
/** A new order reached the kitchen: the merchant app rings now, then re-reads the board. */
export const LiveNewOrder = z.object({
  type: z.literal('new_order'),
  orderId: z.string(),
  merchantOrgId: z.string(),
});
/** A chat message was sent in a thread (`chat.thread` and the unread badges change). */
export const LiveChat = z.object({
  type: z.literal('chat'),
  orderId: z.string(),
  kind: ChatThreadKind,
  threadId: z.string(),
  seq: z.number().int(),
});

/**
 * The public share page's stream (`live.share`, maps program SP5c): the whole shared trip, re-read on
 * the server — the same coarse data as `tracking.shared`, never a bus event passed through.
 */
export const LiveShare = z.object({
  type: z.literal('share'),
  trip: SharedTrip,
});

export const LiveEvent = z.discriminatedUnion('type', [
  LiveHello,
  LiveInvalidate,
  LiveOrderState,
  LivePosition,
  LiveDriverPin,
  LiveNewOrder,
  LiveChat,
  LiveShare,
]);
export type LiveEvent = z.infer<typeof LiveEvent>;
/** What travels on the bus: everything but `hello` (per connection) and `share` (built per stream). */
export type LiveBusEvent = Exclude<LiveEvent, { type: 'hello' | 'share' }>;

/** Channel names on the bus (Redis keys are prefixed by the bus). */
export const liveChannel = {
  order: (orderId: string) => `order:${orderId}`,
  driver: (personId: string) => `driver:${personId}`,
  merchant: (merchantOrgId: string) => `merchant:${merchantOrgId}`,
  chat: (orderId: string, kind: ChatThreadKind) => `chat:${orderId}:${kind}`,
  city: (cityId: string) => `city:${cityId}`,
  /** Events whose city the fan-out cannot tell (an idle driver's pin); every Console board listens. */
  anyCity: () => 'city:*',
  /** SOS incidents of every city: the Console's red banner listens on every page. */
  safety: () => 'safety',
} as const;

// ───────────────────────── inputs / outputs ─────────────────────────

export const LiveOrderInput = z.object({ orderId: z.string().min(1) });
export const LiveMerchantBoardInput = z.object({ merchantOrgId: z.string().min(1) });
/**
 * Chat threads are created lazily (no `threadId` before the first message), so a thread is named by
 * its order and kind — the same key `chat.thread` takes.
 */
export const LiveChatInput = z.object({ orderId: z.string().min(1), kind: ChatThreadKind });
export const LiveConsoleBoardInput = z.object({ cityId: CityId });

/** Connection params of a live stream (`?connectionParams=` on the SSE URL). */
export const LiveConnectionParams = z.object({ streamToken: z.string().min(1) });
export type LiveConnectionParams = z.infer<typeof LiveConnectionParams>;

export const LiveToken = z.object({ token: z.string(), expiresAt: z.coerce.date() });
export type LiveToken = z.infer<typeof LiveToken>;

/** The part of AbortSignal a stream watches (structural: no DOM types in this package). */
export interface LiveAbortSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

/** One open stream as the router hands it to the API (`ctx.live.stream`). */
export interface LiveStreamRequest {
  actor: Actor;
  /** The verified claims the stream was opened with (stream token or Bearer): it ends at `exp`. */
  claims: SessionClaims;
  channels: readonly string[];
  /** The scoping check of the matching query; run on connect and every `recheckMs`. Throws to refuse/end. */
  check: () => Promise<unknown>;
  /** Drops events the subscriber should not get (e.g. other chat kinds); default: all. */
  filter?: (event: LiveBusEvent) => boolean;
  signal?: LiveAbortSignal | undefined;
}

/**
 * Wake-ups for a public stream (`live.share`): it builds its own payload, so nothing from the bus is
 * handed over — only "something on these channels moved" or "time to look again".
 */
export interface LiveWatchRequest {
  channels: readonly string[];
  /** Wake up at least this often even when the channels are quiet. */
  everyMs: number;
  /** Events closer together than this are one wake-up. */
  minGapMs: number;
  signal?: LiveAbortSignal | undefined;
}

/** Implemented by the API's `live` module. */
export interface LivePort {
  /** A stream token for the caller's session (Bearer-authenticated). */
  token(actor: Actor, claims: SessionClaims): Promise<LiveToken>;
  /** Verifies a stream token from connection params: signature, audience, expiry, live session. */
  authenticate(streamToken: string): Promise<SessionClaims>;
  /** The event stream: `hello`, then bus events of `channels`, until abort, a failed re-check or token expiry. */
  stream(req: LiveStreamRequest): AsyncIterable<LiveEvent>;
  /** Yields once listening, then once per wake-up (`LiveWatchRequest`), until abort or shutdown. */
  watch(req: LiveWatchRequest): AsyncIterable<void>;
}
