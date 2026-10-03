import { CityPricingConfig } from './city-config.js';
import { PriceRequest, Quote } from './pricing.js';
import { CityConfigInput, HealthPing } from './router-io.js';
import { dispatchRouter } from './routers/dispatch.js';
import { identityRouter } from './routers/identity.js';
import { ordersRouter } from './routers/orders.js';
import { tripsRouter } from './routers/trips.js';
import { ledgerRouter } from './routers/ledger.js';
import { consoleRouter, driversRouter, merchantsRouter, systemRouter } from './routers/console.js';
import { publicProcedure, router } from './trpc.js';

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
  orders: ordersRouter,
  trips: tripsRouter,
  dispatch: dispatchRouter,
  ledger: ledgerRouter,
  console: consoleRouter,
  drivers: driversRouter,
  merchants: merchantsRouter,
  system: systemRouter,
});

export type AppRouter = typeof appRouter;
