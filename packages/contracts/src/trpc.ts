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
import type { OnCallServicePort } from './on-call-io.js';
import type { InboxServicePort } from './inbox-io.js';
import type { ControlRoomPort, ControlsPort } from './control-room-io.js';
import type { ZoneChecksPort, ZonesPort } from './zones-io.js';
import type { SupportPort } from './support-io.js';
import type { SafetyPort } from './safety-io.js';
import type { ReferralsPort } from './referral-io.js';
import type { RideHabitsPort } from './ride-habits-io.js';
import type { PhoneBookingPort } from './phone-booking-io.js';
import type { GarageTaxiPort } from './garage-taxi-io.js';
import { transformer } from './transformer.js';

// ───────────────────────── context ─────────────────────────

/**
 * The router lives here so every client shares one `AppRouter` type without importing API
 * internals. The API supplies the implementation through `AppContext`.
 */
export interface AppContext {
  /** The quote a client may book with: kept server-side for a while (LOAD-01), hence async. */
  pricing: { quote(req: PriceRequest): Quote | Promise<Quote> };
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
  /** Taxi/tuktuk step 4 (v4): rides booked by phone from the Console (`modules/phone-booking`). */
  phoneBookings: PhoneBookingPort;
  /** Taxi ideas x2/x3/x4: taxis linked to a الرجعة seat (`modules/garage-taxi`). */
  garageTaxi: GarageTaxiPort;
  /** Console E1: the on-call roster and the alert ladder (`modules/on-call`). */
  onCall: OnCallServicePort;
  inbox: InboxServicePort;
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

/** Procedure metadata: the roles a protected procedure admits (read by the audit coverage test, CON-10). */
export interface ProcedureMeta {
  roles?: readonly RoleKind[];
}

export const t = initTRPC.context<AppContext>().meta<ProcedureMeta>().create({
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

/** One finished procedure call, for the API's request log and metrics (`observeProcedures`). */
export interface ProcedureCall {
  /** e.g. `orders.place`. */
  path: string;
  type: 'query' | 'mutation' | 'subscription';
  /** `OK`, or the tRPC error code the caller got (`BAD_REQUEST`, `CONFLICT`, `INTERNAL_SERVER_ERROR`…). */
  code: string;
  /** The Driver error code inside it (`offer_taken`, `rate_limited`…), when there is one. */
  driverCode?: string;
  ms: number;
  /** The signed-in person's id (pseudonymous; names and phones live in the vault), null when signed out. */
  personId: string | null;
}

let procedureObserver: ((call: ProcedureCall) => void) | undefined;

/**
 * The API registers one observer at boot (`shared/request-log.ts`); every call through
 * `publicProcedure` reports to it once it settles. An observer that throws is ignored: the request
 * log must never fail a request.
 */
export function observeProcedures(observer: ((call: ProcedureCall) => void) | undefined): void {
  procedureObserver = observer;
}

function report(call: ProcedureCall): void {
  try {
    procedureObserver?.(call);
  } catch {
    // The log is best-effort.
  }
}

let procedureGate: ((call: { path: string; type: ProcedureCall['type'] }) => DriverError | null) | undefined;

/**
 * The API registers one gate at boot: asked before every call through `publicProcedure`; a
 * DriverError it returns refuses the call (CORE-05: a build older than the minimum gets
 * `update_required`). A gate that throws lets the call through.
 */
export function gateProcedures(gate: typeof procedureGate): void {
  procedureGate = gate;
}

function refusal(path: string, type: ProcedureCall['type']): DriverError | null {
  try {
    return procedureGate?.({ path, type }) ?? null;
  } catch {
    return null;
  }
}

/**
 * Maps a DriverError thrown anywhere below to its tRPC code (and so its HTTP status: offer_taken →
 * 409, dev_only → 403…). tRPC v11 does not throw out of `next()`: a failing resolver or middleware
 * comes back as `{ ok: false, error }` with the DriverError wrapped as INTERNAL_SERVER_ERROR's
 * `cause`, so the result is inspected, not caught. Throwing here is turned back into a result by
 * tRPC with the new code. Each call is first asked of the API's gate (`gateProcedures`) and then
 * reported to its observer (`observeProcedures`).
 */
export const publicProcedure = t.procedure.use(async ({ ctx, path, type, next }) => {
  const started = Date.now();
  const done = (code: string, driverCode?: string) =>
    procedureObserver && report({ path, type, code, ...(driverCode ? { driverCode } : {}), ms: Date.now() - started, personId: ctx.auth?.sub ?? null });
  const refused = refusal(path, type);
  if (refused) {
    const mapped = toTrpcError(refused);
    done(mapped.code, refused.code);
    throw mapped;
  }
  let result;
  try {
    result = await next();
  } catch (err) {
    const mapped = toTrpcError(err);
    done(mapped.code, isDriverError(err) ? err.code : undefined);
    throw mapped;
  }
  if (!result.ok && result.error.code === 'INTERNAL_SERVER_ERROR' && isDriverError(result.error.cause)) {
    const cause = result.error.cause;
    const mapped = toTrpcError(cause);
    done(mapped.code, cause.code);
    throw mapped;
  }
  if (result.ok) done('OK');
  else done(result.error.code, isDriverError(result.error.cause) ? result.error.cause.code : undefined);
  return result;
});

/**
 * The caller's live roles, read once per HTTP request (CON-21): the Console batches several calls
 * into one request, and each used to cost up to one query per allowed role. Keyed by the request's
 * decoded token object, so the cache dies with the request and a revoked or frozen role still takes
 * effect on the very next request.
 */
const rolesThisRequest = new WeakMap<object, Promise<ReadonlySet<RoleKind>>>();

async function allowedFor(ctx: AppContext, personId: string, roles: readonly RoleKind[]): Promise<boolean> {
  const identity = ctx.identity;
  if (!identity.activeRoles || !ctx.auth) {
    for (const kind of roles) if (await identity.hasRole(personId, kind)) return true;
    return false;
  }
  let held = rolesThisRequest.get(ctx.auth);
  if (!held) {
    held = identity.activeRoles(personId).then((r) => new Set(r));
    rolesThisRequest.set(ctx.auth, held);
    // A failed read is not remembered: the next call in the batch asks again.
    held.catch(() => rolesThisRequest.delete(ctx.auth!));
  }
  const set = await held;
  return roles.some((k) => set.has(k));
}

/**
 * Requires a valid access token; with `roles`, requires at least one of them (live lookup, so a
 * revoked or frozen role takes effect on the next request, not at token expiry).
 */
export function protectedProcedure(roles?: readonly RoleKind[]) {
  return publicProcedure.meta(roles ? { roles } : {}).use(async ({ ctx, next }) => {
    if (!ctx.auth) throw toTrpcError(new DriverError(ctx.authError ?? 'unauthorized'));
    const actor: Actor = { personId: ctx.auth.sub, sessionId: ctx.auth.sid, ...(ctx.auth.did ? { deviceId: ctx.auth.did } : {}) };
    if (roles && roles.length > 0 && !(await allowedFor(ctx, actor.personId, roles))) throw toTrpcError(new DriverError('forbidden'));
    return next({ ctx: { ...ctx, actor } });
  });
}
