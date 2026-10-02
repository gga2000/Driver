import { initTRPC } from '@trpc/server';
import { CityPricingConfig } from './city-config.js';
import { PriceRequest, Quote } from './pricing.js';
import { CityConfigInput, HealthPing } from './router-io.js';
import { transformer } from './transformer.js';

/**
 * The router lives here so every client shares one `AppRouter` type without
 * importing API internals. The API supplies the implementation through `AppContext`.
 */
export interface AppContext {
  pricing: { quote(req: PriceRequest): Quote };
  config: { city(cityId: string): CityPricingConfig | undefined };
  now(): Date;
  version: string;
}

const t = initTRPC.context<AppContext>().create({ transformer });

export const appRouter = t.router({
  health: t.router({
    ping: t.procedure.output(HealthPing).query(({ ctx }) => ({
      ok: true as const,
      service: 'driver-api' as const,
      version: ctx.version,
      now: ctx.now(),
    })),
  }),
  pricing: t.router({
    quote: t.procedure
      .input(PriceRequest)
      .output(Quote)
      .query(({ ctx, input }) => ctx.pricing.quote(input)),
  }),
  config: t.router({
    city: t.procedure
      .input(CityConfigInput)
      .output(CityPricingConfig.nullable())
      .query(({ ctx, input }) => ctx.config.city(input.cityId) ?? null),
  }),
});

export type AppRouter = typeof appRouter;
