import type { RoleKind, SessionClaims } from '../auth.js';
import { DriverError } from '../errors.js';
import type { Actor } from '../identity-io.js';
import {
  LIVE_RULES,
  LiveChatInput,
  LiveConsoleBoardInput,
  LiveMerchantBoardInput,
  LiveOrderInput,
  LiveToken,
  liveChannel,
  type LiveAbortSignal,
  type LiveBusEvent,
  type LiveEvent,
} from '../live-io.js';
import { PARTNER_DRIVING_ROLES } from '../partner-io.js';
import { SAFETY_DESK_ROLES } from '../safety-io.js';
import { SHARE_LIVE_RULES, SharedTripInput } from '../share-io.js';
import { TripChatRef } from '../trip-chat-io.js';
import {
  protectedProcedure,
  publicProcedure,
  router,
  toTrpcError,
  type AppContext,
} from '../trpc.js';
import { CONSOLE_READ_ROLES } from './console.js';
import { MERCHANT_ROLES } from './orders.js';

/**
 * Accepts the Bearer token (server-side clients, tests) or the stream token from the SSE URL's
 * connection params (`ctx.liveAuth`, browsers and phones: EventSource cannot set headers). With
 * `roles`, at least one of them must be held (live lookup, like `protectedProcedure`).
 */
function liveProcedure(roles?: readonly RoleKind[]) {
  return publicProcedure.use(async ({ ctx, next }) => {
    const claims = ctx.auth ?? ctx.liveAuth ?? null;
    if (!claims)
      throw toTrpcError(new DriverError(ctx.liveAuthError ?? ctx.authError ?? 'unauthorized'));
    const actor: Actor = {
      personId: claims.sub,
      sessionId: claims.sid,
      ...(claims.did ? { deviceId: claims.did } : {}),
    };
    if (roles && roles.length > 0 && !(await holdsAny(ctx, actor.personId, roles)))
      throw toTrpcError(new DriverError('forbidden'));
    return next({ ctx: { ...ctx, actor, claims } });
  });
}

async function holdsAny(
  ctx: Pick<AppContext, 'identity'>,
  personId: string,
  roles: readonly RoleKind[],
): Promise<boolean> {
  for (const kind of roles) if (await ctx.identity.hasRole(personId, kind)) return true;
  return false;
}

/** Re-check of a role-scoped stream: the role may be revoked or frozen while it is open. */
const requireRoles =
  (ctx: Pick<AppContext, 'identity'>, personId: string, roles: readonly RoleKind[]) => async () => {
    if (!(await holdsAny(ctx, personId, roles))) throw new DriverError('forbidden');
  };

/** The API's stream with domain errors turned into tRPC codes (FORBIDDEN, UNAUTHORIZED are final for the client). */
async function* stream(
  ctx: { live: AppContext['live']; actor: Actor; claims: SessionClaims },
  opts: {
    channels: string[];
    check: () => Promise<unknown>;
    filter?: (e: LiveBusEvent) => boolean;
    signal: LiveAbortSignal | undefined;
  },
): AsyncGenerator<LiveEvent, void, unknown> {
  try {
    yield* ctx.live.stream({
      actor: ctx.actor,
      claims: ctx.claims,
      channels: opts.channels,
      check: opts.check,
      ...(opts.filter ? { filter: opts.filter } : {}),
      signal: opts.signal,
    });
  } catch (err) {
    throw toTrpcError(err);
  }
}

/**
 * The public share page's stream (maps program SP5c): `hello`, then the shared trip re-read on every
 * wake-up — its ride channel moved (≤ every 2 s) or `SHARE_LIVE_RULES` time passed — until it has
 * ended (expired, revoked, cancelled). The token is the only credential, checked on every read; the
 * reads never count as page views.
 */
async function* shareStream(
  ctx: Pick<AppContext, 'live' | 'trackingShare'>,
  input: SharedTripInput,
  signal: LiveAbortSignal | undefined,
): AsyncGenerator<LiveEvent, void, unknown> {
  try {
    const read = { token: input.token, again: true };
    const channels = await ctx.trackingShare.liveChannels(read);
    const everyMs = channels.length > 0 ? SHARE_LIVE_RULES.refreshMs : SHARE_LIVE_RULES.intercityMs;
    const wakes = ctx.live.watch({ channels, everyMs, minGapMs: LIVE_RULES.positionThrottleMs, signal })[Symbol.asyncIterator]();
    try {
      let first = true;
      while (!(await wakes.next()).done) {
        const trip = await ctx.trackingShare.shared(read);
        if (first) {
          first = false;
          // No internal channel names on a public stream.
          yield { type: 'hello', channels: ['share'], serverNow: trip.serverNow };
        }
        yield { type: 'share', trip };
        if (trip.status === 'ended') return;
      }
    } finally {
      // Stops listening on the bus whichever way the stream ends.
      await wakes.return?.();
    }
  } catch (err) {
    throw toTrpcError(err);
  }
}

/**
 * `live.*`: tRPC subscriptions over SSE (`httpSubscriptionLink`). Each stream starts with `hello`
 * and carries compact invalidate/patch events for one scope; the scope check is the one of the
 * matching query, run on connect and re-run by the API every `LIVE_RULES.recheckMs`.
 */
export const liveRouter = router({
  /** A short-lived stream token for `connectionParams` (Bearer-authenticated like any mutation). */
  token: protectedProcedure()
    .output(LiveToken)
    .mutation(({ ctx }) => {
      if (!ctx.auth) throw toTrpcError(new DriverError('unauthorized'));
      return ctx.live.token(ctx.actor, ctx.auth);
    }),
  /** Customer tracking (`orders.track` scope: the orderer or a participant): state, courier position, chat badges. */
  order: liveProcedure()
    .input(LiveOrderInput)
    .subscription(({ ctx, input, signal }) =>
      stream(ctx, {
        channels: [liveChannel.order(input.orderId)],
        check: () => ctx.tracking.track(ctx.actor, input),
        signal,
      }),
    ),
  /** The driver's own channel (no input: nobody can name another driver's): offers, job, presence/gate, cash and earnings. */
  partner: liveProcedure(PARTNER_DRIVING_ROLES).subscription(({ ctx, signal }) =>
    stream(ctx, {
      channels: [liveChannel.driver(ctx.actor.personId)],
      check: requireRoles(ctx, ctx.actor.personId, PARTNER_DRIVING_ROLES),
      signal,
    }),
  ),
  /** The kitchen board (`merchant.storeStatus` scope: a merchant role on this store): new/changed orders, couriers, store status. */
  merchantBoard: liveProcedure(MERCHANT_ROLES)
    .input(LiveMerchantBoardInput)
    .subscription(({ ctx, input, signal }) =>
      stream(ctx, {
        channels: [liveChannel.merchant(input.merchantOrgId)],
        check: () => ctx.merchant.storeStatus(ctx.actor, input),
        signal,
      }),
    ),
  /** One chat thread (`chat.threads` scope: a party of that thread, or support). */
  chat: liveProcedure()
    .input(LiveChatInput)
    .subscription(({ ctx, input, signal }) =>
      stream(ctx, {
        channels: [liveChannel.chat(input.orderId, input.kind)],
        check: async () => {
          const threads = await ctx.chat.threads(ctx.actor, { orderId: input.orderId });
          if (!threads.some((t) => t.kind === input.kind)) throw new DriverError('chat_not_party');
        },
        signal,
      }),
    ),
  /**
   * One Baghdad/Kut pair thread (step 4c; `chat.trip.thread` scope). The thread is keyed by the side
   * named in `with`, or by the caller when he is that side (the rider of a run, the driver of a request).
   */
  tripChat: liveProcedure()
    .input(TripChatRef)
    .subscription(({ ctx, input, signal }) =>
      stream(ctx, {
        channels: [liveChannel.tripChat(input.id, input.with ?? ctx.actor.personId)],
        check: async () => {
          await ctx.tripChat.thread(ctx.actor, { ...input, afterSeq: Number.MAX_SAFE_INTEGER });
        },
        signal,
      }),
    ),
  /** Public (no sign-in): the family share page (`tracking.shared` scope: the signed token alone). */
  share: publicProcedure
    .input(SharedTripInput)
    .subscription(({ ctx, input, signal }) => shareStream(ctx, input, signal)),
  /** SOS incidents (dispatchers, support, admins): every page of the Console listens for the red banner. */
  safety: liveProcedure(SAFETY_DESK_ROLES).subscription(({ ctx, signal }) =>
    stream(ctx, {
      channels: [liveChannel.safety()],
      check: requireRoles(ctx, ctx.actor.personId, SAFETY_DESK_ROLES),
      signal,
    }),
  ),
  /** The Console dispatch board for a city (back-office read roles): requests, trips, orders, driver pins. */
  consoleBoard: liveProcedure(CONSOLE_READ_ROLES)
    .input(LiveConsoleBoardInput)
    .subscription(({ ctx, input, signal }) =>
      stream(ctx, {
        channels: [liveChannel.city(input.cityId), liveChannel.anyCity()],
        check: requireRoles(ctx, ctx.actor.personId, CONSOLE_READ_ROLES),
        signal,
      }),
    ),
});
