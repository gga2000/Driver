import { CityPricingConfig } from './city-config.js';
import { PriceRequest, Quote } from './pricing.js';
import { TRPCError } from '@trpc/server';
import { CityConfigInput, HealthLive, HealthPing, HealthReady, liveDbGate } from './router-io.js';
import { dispatchRouter } from './routers/dispatch.js';
import { identityRouter } from './routers/identity.js';
import { driverAccountRouter } from './routers/driver-account.js';
import { khatRouter } from './routers/khat.js';
import { fleetRouter } from './routers/fleet.js';
import { opsRouter } from './routers/ops.js';
import { merchantAdminRouter } from './routers/merchant-admin.js';
import { ordersRouter } from './routers/orders.js';
import { tripsRouter } from './routers/trips.js';
import { ledgerRouter } from './routers/ledger.js';
import { routesRouter } from './routers/routes.js';
import { catalogRouter, searchRouter } from './routers/catalog.js';
import { consoleRouter, driversRouter, merchantsRouter, systemRouter } from './routers/console.js';
import { householdRouter, placesRouter, walletRouter } from './routers/account.js';
import { partnerRouter } from './routers/partner.js';
import { merchantRouter } from './routers/merchant.js';
import { chatRouter } from './routers/chat.js';
import { trackingRouter } from './routers/tracking.js';
import { liveRouter } from './routers/live.js';
import { notifyRouter } from './routers/notify.js';
import { approvalsRouter, bannerProcedures, financeRouter, metricsRouter, seasonProcedures } from './routers/control-room.js';
import { supportRouter } from './routers/support.js';
import { safetyRouter } from './routers/safety.js';
import { referralRouter } from './routers/referral.js';
import { rideHabitsRouter } from './routers/ride-habits.js';
import { phoneBookingsRouter } from './routers/phone-booking.js';
import { inboxRouter } from './routers/inbox.js';
import { onCallRouter } from './routers/on-call.js';
import { garageTaxiRouter } from './routers/garage-taxi.js';
import { publicProcedure, router, t } from './trpc.js';

export type { AppContext, IdentityPort, Actor } from './trpc.js';
export { observeProcedures, protectedProcedure, publicProcedure, router, t, toTrpcError, type ProcedureCall } from './trpc.js';

/** One per process: `health.live` rides out short database blips (`LIVE_DB_GRACE_MS`). */
const liveGate = liveDbGate();

/**
 * The router lives here so every client shares one `AppRouter` type without
 * importing API internals. The API supplies the implementation through `AppContext`.
 */
export const appRouter = router({
  health: router({
    ping: publicProcedure.output(HealthPing).query(async ({ ctx }) => {
      const [db, redis] = await Promise.all([ctx.health.db(), ctx.health.redis()]);
      return { ok: true as const, service: 'driver-api' as const, version: ctx.version, now: ctx.now(), db, redis };
    }),
    live: publicProcedure.output(HealthLive).query(async ({ ctx }) => {
      const now = ctx.now();
      if (!liveGate.alive(await ctx.health.db(), now)) throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'database unavailable' });
      return { ok: true as const, service: 'driver-api' as const, version: ctx.version, now };
    }),
    ready: publicProcedure.output(HealthReady).query(async ({ ctx }) => {
      const [db, redis] = await Promise.all([ctx.health.db(), ctx.health.redis()]);
      return { ok: db === 'ok' && redis === 'ok', service: 'driver-api' as const, version: ctx.version, now: ctx.now(), db, redis };
    }),
  }),
  pricing: router({
    quote: publicProcedure
      .input(PriceRequest)
      .output(Quote)
      .query(({ ctx, input }) => ctx.pricing.quote(input)),
  }),
  config: router({
    city: publicProcedure
      .input(CityConfigInput)
      .output(CityPricingConfig.nullable())
      .query(({ ctx, input }) => ctx.config.city(input.cityId) ?? null),
  }),
  identity: identityRouter,
  driverAccount: driverAccountRouter,
  khat: khatRouter,
  fleet: fleetRouter,
  ops: opsRouter,
  merchantAdmin: merchantAdminRouter,
  orders: ordersRouter,
  trips: tripsRouter,
  dispatch: dispatchRouter,
  ledger: ledgerRouter,
  routes: routesRouter,
  catalog: catalogRouter,
  search: searchRouter,
  console: consoleRouter,
  drivers: driversRouter,
  merchants: merchantsRouter,
  // Launch control room: `system.banner` (public) and its admin side join the system router.
  system: t.mergeRouters(systemRouter, router({ ...bannerProcedures, ...seasonProcedures })),
  places: placesRouter,
  wallet: walletRouter,
  household: householdRouter,
  partner: partnerRouter,
  merchant: merchantRouter,
  chat: chatRouter,
  tracking: trackingRouter,
  live: liveRouter,
  notify: notifyRouter,
  // Launch control room (kill switches live under `ops.controls`).
  approvals: approvalsRouter,
  support: supportRouter,
  // SOS (scoring & safety §3): the person's alert and the Console's incident desk.
  safety: safetyRouter,
  referral: referralRouter,
  // Joy J7d: favourite drivers, regular trips, dinner timed to the ride home.
  rideHabits: rideHabitsRouter,
  // Taxi/tuktuk step 4 (v4): Console › حجز بالتلفون — a ride booked for a caller without the app.
  phoneBookings: phoneBookingsRouter,
  onCall: onCallRouter,
  inbox: inboxRouter,
  // Taxi ideas x2/x3/x4: taxis linked to a الرجعة seat (to the car, late notice, waiting at the garage).
  garageTaxi: garageTaxiRouter,
  finance: financeRouter,
  metrics: metricsRouter,
});

export type AppRouter = typeof appRouter;
