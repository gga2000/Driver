# Real-time channel (`live.*`)

Date: 2026-10-04. Replaces the apps' fast polling (2–5 s) with tRPC v11 subscriptions over SSE.
Contracts: `packages/contracts/src/{live-io,live-client}.ts`, `routers/live.ts`; API: `apps/api/src/modules/live`.

## Shape

```
domain event ─► outbox ─► subscriber `live:fanout` ─► LiveBus (Redis pub/sub | in-memory) ─► open SSE streams ─► client
trips.reportPosition ─► (after commit) PositionFanout, ≤ 1 fix / 2 s / driver ───────┘
```

- **Events are compact**: ids plus `invalidate {keys[]}` (the queries to re-read) or a minimal patch —
  `order_state`, `position` (courier fix), `driver_pin`, `new_order` (the kitchen's ring), `chat`.
  Every stream starts with `hello`. Data is always re-read through the ordinary queries, with their
  own auth and scoping: a lost event costs freshness, never correctness.
- **Channels**: `order:<id>`, `driver:<personId>`, `merchant:<orgId>`, `chat:<orderId>:<kind>`,
  `city:<cityId>` and `city:*` (pins of idle drivers, whose city the fan-out cannot tell).
- **Bus**: `RedisLiveBus` when `REDIS_URL` is set (one PUBLISH connection, one subscriber-mode
  connection; a channel is SUBSCRIBEd while a local stream listens, and `hello` waits for the
  acknowledgement), so it works across API instances; `InMemoryLiveBus` otherwise. Publishing is
  best-effort and after the delivery commits; without any open stream (simulator, tests) the
  fan-out skips its lookups.

| Subscription | Scope check (same as the query) | Channels | Carries |
|---|---|---|---|
| `live.order({orderId})` | `orders.track` (orderer or participant) | `order:<id>` | state, courier position (sharing window only), chat badges |
| `live.partner()` | a driving partner role; **no input** — the channel is the caller's own | `driver:<me>` | offer, job changes, presence/gate (role/person events), cash & earnings |
| `live.merchantBoard({merchantOrgId})` | `merchant.storeStatus` (merchant role scoped to that store) | `merchant:<org>` | new order (ring), order/courier changes, store status, chat badges |
| `live.chat({orderId, kind})` | `chat.threads` lists that kind for the caller | `chat:<orderId>:<kind>` | new messages |
| `live.consoleBoard({cityId})` | Console read roles | `city:<id>`, `city:*` | dispatch board, trips, active orders, right-now bar, driver pins |

`live.chat` takes `{orderId, kind}` rather than a thread id: threads are created lazily on the first
message, so a fresh chat screen has no id yet (it is the same key `chat.thread` takes).

**Re-checks**: the scope check and the session (`identity.assertSessionLive`: not revoked, same
person/device) are re-run every 30 s on an open stream; a failure ends it with FORBIDDEN /
UNAUTHORIZED. The stream ends with `session_expired` (401) when the token it was opened with
expires. A client that falls 256 events behind is cut off (it reconnects and resyncs). Module
shutdown ends every stream.

**Courier position**: `TripsService.onPositionReported` (after commit; positions are not domain
events) → throttled per driver to ≥ 2 s (leading + trailing: the newest fix of a burst is sent when the
window ends) → each order on his trip, only while the trip is accepted and in a visible state and that
order's own drop-off is not done (the rules of `orders.courierPosition`), and a pin to the city board.

## Auth over SSE — decision

EventSource cannot set headers. **Chosen: a short-lived signed stream token in tRPC
`connectionParams`.** The client calls `live.token` (an ordinary Bearer-authenticated mutation) and
opens the stream with `?connectionParams={"streamToken":"…"}`.

- The stream token is HS256 with its own issuer/audience and a key derived from `JWT_SECRET`
  (or `LIVE_TOKEN_SECRET`): it is never accepted as an access token, and the access token is never
  put in a URL (proxy/access logs).
- It authenticates the live router only (`ctx.liveAuth`, separate from `ctx.auth`).
- It expires with the access token it was minted with, and after at most 15 min.
- The client caches it (`createStreamTokenCache`) and drops it on a 401, so the next connection
  mints a fresh one after the session refreshed.

## Clients

`@driver/contracts/live-client` (no React, no DOM types):

- `createLiveConnection` — keeps one subscription alive: connect timeout 12 s (a proxy that buffers
  SSE never says `hello`), reconnect with backoff (1 s × 2ⁿ, ≤ 30 s, ±20 %), **resync on every
  `hello`** (the hook invalidates what the channel covers), `fallback` mode after 3 failures in a row
  (it keeps retrying). `livePollMs(mode)`: 60-s safety refetch while live, 30-s polling otherwise.
- `XhrEventSource` (React Native has no EventSource) and `installReadableStreamPolyfill` (Hermes has
  no ReadableStream, which tRPC's SSE consumer needs); `createFetchEventSource` for Node (e2e).

Each app: `httpSubscriptionLink` + `splitLink` in `src/lib/api.tsx`, `useLiveChannel` in
`src/lib/live.ts` (invalidations batched per 250 ms, reconnect on app foreground), and feature hooks:
`useLiveOrder` (order screen; patches position and state), `useLiveChat` (chat screen),
`useLivePartner` (root layout), `useLiveMerchantBoard` (MerchantRuntime: rings on `new_order` at
once, then re-reads the board), the Console's shared `live.consoleBoard` connection in `lib/live.ts`.

## What still polls

- Safety refetch on every covered query (60 s live / 30 s fallback).
- Not covered by a channel yet: الرجعة boards and bookings (customer, partner intercity), خطوط runs,
  fleet and ops screens (partner), the wallet top-up code screen (3 s while pending), home's active
  order pill (15 s), the public share page, merchant money/deals/hours, store status (30 s: busy mode
  ends by time), Console order detail/event logs, system and health pages.

## Known gaps

- `dispatch.drivers` pins: the Console re-reads them (≤ every 2 s) on `driver_pin`; presence itself is
  not a domain event, so a driver going online/offline shows on the next safety refetch.
- Customer wallet top-up confirmation and الرجعة have no channel (no per-customer channel yet).
- The Console has no token refresh (unchanged): its stream ends with the 15-min access token.
- Native RN streaming relies on XHR incremental `responseText` (`onprogress`); verified on web and in
  Node, not yet on a device.
