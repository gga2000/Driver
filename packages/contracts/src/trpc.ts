import { initTRPC, TRPCError } from '@trpc/server';
import type { RoleKind, SessionClaims } from './auth.js';
import type { Actor, IdentityPort } from './identity-io.js';
export type { Actor, IdentityPort } from './identity-io.js';
import type { CityPricingConfig } from './city-config.js';
import type { ConsolePort } from './console-io.js';
import type { DispatchPort } from './dispatch-io.js';
import type { LedgerPort } from './ledger-io.js';
import { DriverError, errorEnvelope, isDriverError, type ErrorCode } from './errors.js';
import type { OrdersPort } from './order.js';
import type { PriceRequest, Quote } from './pricing.js';
import type { TripsPort } from './trip.js';
import type { TrackingPort } from './tracking.js';
import type { RoutesPort } from './routes-io.js';
import type { CustomerCatalogPort } from './catalog-io.js';
import type { HouseholdsPort, InsightsPort, PlacesPort, WalletPort } from './account-io.js';
import type { PartnerPort } from './partner-io.js';
import type { DependencyStatus } from './router-io.js';
import type { DriverAccountPort } from './driver-account-io.js';
import type { KhatPort } from './khat-io.js';
import type { FleetPort } from './fleet-io.js';
import type { OpsPort } from './ops-io.js';
import type { MenuPhotosPort } from './menu-photos-io.js';
import type { MerchantAdminPort } from './merchant-admin-io.js';
import type { MerchantPort, PickupSpotsOpsPort } from './merchant-io.js';
import type { TopUpPort } from './topup-io.js';
import type { ChatPort } from './chat-io.js';
import type { TrackingSharePort } from './share-io.js';
import { LIVE_RULES, type LivePort } from './live-io.js';
import type { NotifyPort } from './notify-io.js';
import type { ControlRoomPort, ControlsPort } from './control-room-io.js';
import type { ZoneChecksPort, ZonesPort } from './zones-io.js';
import type { SupportPort } from './support-io.js';
import type { SafetyPort } from './safety-io.js';
import type { ReferralsPort } from './referral-io.js';
import type { RideHabitsPort } from './ride-habits-io.js';
import { transformer } from './transformer.js';

// ───────────────────────── context ─────────────────────────

/**
 * The router lives here so every client shares one `AppRouter` type without importing API
 * internals. The API supplies the implementation through `AppContext`.
 */
export interface AppContext {
  pricing: { quote(req: PriceRequest): Quote };
  config: { city(cityId: string): CityPricingConfig | undefined };
  health: { db(): Promise<DependencyStatus>; redis(): Promise<DependencyStatus> };
  identity: IdentityPort;
  /** Partner wave 2: a driving person's earnings, scorecard, documents, check-in (`modules/driver-account`). */
  driverAccount: DriverAccountPort;
  /** Partner wave 2: خطوط driver side — run, taps, absences, substitutes (`modules/khat`). */
  khat: KhatPort;
  /** Partner wave 2: fleet owner dashboard (`modules/fleet`). */
  fleet: FleetPort;
  /** Partner wave 2: field ops mode (`modules/ops`). */
  ops: OpsPort;
  /** Menu photo service (maps k3): merchant requests, field ops shoots, Console queue (`modules/menu-photos`). */
  menuPhotos: MenuPhotosPort;
  /** Console › المطاعم: stores' pickup spots set by field ops (`modules/ops` over `modules/merchant`). */
  pickupSpots: PickupSpotsOpsPort;
  /** Merchant wave 2: menu, deals, money, insights, staff (`modules/merchant-admin`). */
  merchantAdmin: MerchantAdminPort;
  orders: OrdersPort;
  trips: TripsPort;
  dispatch: DispatchPort;
  ledger: LedgerPort;
  /** الرجعة: garages, departures, seats, demand and request boards (`modules/routes`). */
  routes: RoutesPort;
  /** Customer catalog read: restaurant cards and menus (`modules/catalog`). */
  catalog: CustomerCatalogPort;
  /** Console read side: cross-module views composed by the API's `console` module. */
  console: ConsolePort;
  /** Customer live order/ride screen reads (`modules/tracking`): owner-checked, narrow courier card. */
  tracking: TrackingPort;
  /** Saved places (`modules/places`): owner-checked, zone resolved from the pin. */
  places: PlacesPort;
  /** Customer wallet: balance, points, readable lines, top-up options (`modules/ledger`). */
  wallet: WalletPort;
  /** Joy w6 «شهرك»: the caller's month from orders, rides, الرجعة and the ledger (`modules/insights`). */
  insights: InsightsPort;
  /** Wallet top-up with cash: customer codes, ops-agent / courier confirmation (`modules/topups`). */
  topups: TopUpPort;
  /** Households: members, limits, payer approvals (`modules/orgs`). */
  households: HouseholdsPort;
  /** Driver Partner: own presence, open offer, active job, today's money (`modules/partner`). */
  partner: PartnerPort;
  /** Driver Merchant: my stores, the orders board, store status (`modules/merchant`). */
  merchant: MerchantPort;
  /** In-order chat and masked calls (`modules/chat`): party-checked on every call. */
  chat: ChatPort;
  /** Share-trip links (`modules/tracking`): signed, expiring, revocable; public read is coarse. */
  trackingShare: TrackingSharePort;
  /** Real-time channel (`modules/live`): stream tokens and the SSE event streams of `live.*`. */
  live: LivePort;
  /** Verified claims of the stream token in the SSE URL's connection params (`live.*` only), if any. */
  liveAuth?: SessionClaims | null;
  /** Why `liveAuth` is null when a stream token was presented. */
  liveAuthError?: ErrorCode | null;
  /** Push tokens, notification preferences, the delivery log (`modules/notify`). */
  notify: NotifyPort;
  /** Launch control room: kill switches, zone throttle, status banner, audit log (`modules/controls`). */
  controls: ControlsPort;
  /** Launch control room: approvals queue, nightly cash desk, metrics wall (`modules/control-room`). */
  controlRoom: ControlRoomPort;
  /** Support desk: persisted tickets, case view, refunds within limits (`modules/support`). */
  support: SupportPort;
  /** Zone outlines drawn in the Console (`modules/zones`). */
  zones: ZonesPort;
  /** Drivers confirm zones at the end of a delivery (`modules/zones`, maps program SP3). */
  zoneChecks: ZoneChecksPort;
  /** SOS: the person's alert, the Console's incident desk (`modules/safety`). */
  safety: SafetyPort;
  /** Invite as a gift (joy g2): my code, a friend's claim, the public landing read (`modules/referrals`). */
  referrals: ReferralsPort;
  /** Joy J7d: favourite drivers, regular trips, dinner timed to the ride home (`modules/ride-habits`). */
  rideHabits: RideHabitsPort;
  /** Verified claims of the `Authorization: Bearer` token on this request, if any. */
  auth: SessionClaims | null;
  /** Why `auth` is null when a token was presented (expired, malformed…); null when no token. */
  authError: ErrorCode | null;
  /** The caller as the transport saw it (client IP behind the configured proxy); absent in tests. */
  client?: { ip: string | null };
  env: { nodeEnv: string };
  now(): Date;
  version: string;
}

/** Converts a thrown DriverError into a TRPCError whose `data` carries the envelope. */
export function toTrpcError(err: unknown): TRPCError {
  if (err instanceof TRPCError) return err;
  if (isDriverError(err)) {
    return new TRPCError({ code: err.status, message: err.envelope.message_en, cause: err });
  }
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'internal', cause: err });
}

export const t = initTRPC.context<AppContext>().create({
  transformer,
  // `live.*` subscriptions over SSE: a keep-alive comment so proxies keep idle streams open, and the
  // client reconnects when even those stop arriving.
  sse: { ping: { enabled: true, intervalMs: LIVE_RULES.pingMs }, client: { reconnectAfterInactivityMs: LIVE_RULES.inactivityMs } },
  // Spec §12: clients never see stack traces; every error carries {code, message_ar, retryHint}.
  errorFormatter({ shape, error }) {
    const data = { ...shape.data } as Record<string, unknown>;
    delete data['stack'];
    const cause = error.cause;
    let envelope;
    if (isDriverError(cause)) envelope = cause.envelope;
    else if (error.code === 'UNAUTHORIZED') envelope = errorEnvelope('unauthorized');
    else if (error.code === 'FORBIDDEN') envelope = errorEnvelope('forbidden');
    else if (error.code === 'NOT_FOUND') envelope = errorEnvelope('not_found');
    else if (error.code === 'BAD_REQUEST') envelope = errorEnvelope('invalid_input');
    else envelope = errorEnvelope('internal');
    return { ...shape, message: envelope.message_ar, data: { ...data, ...envelope } };
  },
});

export const router = t.router;

/**
 * Maps a DriverError thrown anywhere below to its tRPC code (and so its HTTP status: offer_taken →
 * 409, dev_only → 403…). tRPC v11 does not throw out of `next()`: a failing resolver or middleware
 * comes back as `{ ok: false, error }` with the DriverError wrapped as INTERNAL_SERVER_ERROR's
 * `cause`, so the result is inspected, not caught. Throwing here is turned back into a result by
 * tRPC with the new code.
 */
export const publicProcedure = t.procedure.use(async ({ next }) => {
  let result;
  try {
    result = await next();
  } catch (err) {
    throw toTrpcError(err);
  }
  if (!result.ok && result.error.code === 'INTERNAL_SERVER_ERROR' && isDriverError(result.error.cause)) throw toTrpcError(result.error.cause);
  return result;
});

/**
 * Requires a valid access token; with `roles`, requires at least one of them (live lookup, so a
 * revoked or frozen role takes effect on the next request, not at token expiry).
 */
export function protectedProcedure(roles?: readonly RoleKind[]) {
  return publicProcedure.use(async ({ ctx, next }) => {
    if (!ctx.auth) throw toTrpcError(new DriverError(ctx.authError ?? 'unauthorized'));
    const actor: Actor = { personId: ctx.auth.sub, sessionId: ctx.auth.sid, ...(ctx.auth.did ? { deviceId: ctx.auth.did } : {}) };
    if (roles && roles.length > 0) {
      let allowed = false;
      for (const kind of roles) {
        if (await ctx.identity.hasRole(actor.personId, kind)) {
          allowed = true;
          break;
        }
      }
      if (!allowed) throw toTrpcError(new DriverError('forbidden'));
    }
    return next({ ctx: { ...ctx, actor } });
  });
}
