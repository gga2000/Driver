import { Injectable, Module, type INestApplication } from '@nestjs/common';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import type { AppContext } from '@driver/contracts';
import { appRouter } from '@driver/contracts/router';
import { ConfigModule, ConfigService } from '../modules/config/index.js';
import { PricingModule, PricingService } from '../modules/pricing/index.js';

export const API_VERSION = '0.1.0';
export const TRPC_PATH = '/trpc';

/** Builds the tRPC context from Nest providers; the router itself lives in @driver/contracts. */
@Injectable()
export class TrpcService {
  constructor(
    private readonly pricing: PricingService,
    private readonly config: ConfigService,
  ) {}

  context(): AppContext {
    return {
      pricing: { quote: (req) => this.pricing.quote(req) },
      config: { city: (id) => this.config.city(id) },
      now: () => new Date(),
      version: API_VERSION,
    };
  }

  mount(app: INestApplication): void {
    app.use(
      TRPC_PATH,
      createExpressMiddleware({
        router: appRouter,
        createContext: () => this.context(),
      }),
    );
  }
}

@Module({ imports: [PricingModule, ConfigModule], providers: [TrpcService], exports: [TrpcService] })
export class TrpcModule {}
