import { CityPricingConfig } from './city-config.js';
import { PriceRequest, Quote } from './pricing.js';
import { CityConfigInput, HealthPing } from './router-io.js';
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
import { catalogRouter } from './routers/catalog.js';
import { consoleRouter, driversRouter, merchantsRouter, systemRouter } from './routers/console.js';
import { householdRouter, placesRouter, walletRouter } from './routers/account.js';
import { partnerRouter } from './routers/partner.js';
import { merchantRouter } from './routers/merchant.js';
import { chatRouter } from './routers/chat.js';
import { trackingRouter } from './routers/tracking.js';
import { liveRouter } from './routers/live.js';
import { notifyRouter } from './routers/notify.js';
import { approvalsRouter, bannerProcedures, financeRouter, metricsRouter } from './routers/control-room.js';
import { supportRouter } from './routers/support.js';
import { safetyRouter } from './routers/safety.js';
import { publicProcedure, router, t } from './trpc.js';

export type { AppContext, IdentityPort, Actor } from './trpc.js';
export { protectedProcedure, publicProcedure, router, t, toTrpcError } from './trpc.js';

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
  console: consoleRouter,
  drivers: driversRouter,
  merchants: merchantsRouter,
  // Launch control room: `system.banner` (public) and its admin side join the system router.
  system: t.mergeRouters(systemRouter, router(bannerProcedures)),
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
  finance: financeRouter,
  metrics: metricsRouter,
});

export type AppRouter = typeof appRouter;
