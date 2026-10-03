import { Injectable, Logger, Module, type INestApplication } from '@nestjs/common';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { isDriverError, type AppContext, type ErrorCode, type SessionClaims } from '@driver/contracts';
import { appRouter } from '@driver/contracts/router';
import { ConfigModule, ConfigService } from '../modules/config/index.js';
import { ConsoleModule, ConsoleReadService } from '../modules/console/index.js';
import { DispatchModule, DispatchService } from '../modules/dispatch/index.js';
import { IdentityModule, IdentityService } from '../modules/identity/index.js';
import { OrdersModule, OrdersRpc } from '../modules/orders/index.js';
import { LedgerFacade, LedgerModule } from '../modules/ledger/index.js';
import { PricingModule, PricingService } from '../modules/pricing/index.js';
import { RoutesModule, RoutesRpc } from '../modules/routes/index.js';
import { TripsModule, TripsRpc } from '../modules/trips/index.js';
import { PrismaService } from '../shared/db/prisma.service.js';
import { BullMqQueueFactory } from '../shared/queue.js';

export const API_VERSION = '0.1.0';
export const TRPC_PATH = '/trpc';

/** Builds the tRPC context from Nest providers; the router itself lives in @driver/contracts. */
@Injectable()
export class TrpcService {
  private readonly logger = new Logger(TrpcService.name);

  constructor(
    private readonly pricing: PricingService,
    private readonly config: ConfigService,
    private readonly identity: IdentityService,
    private readonly ledger: LedgerFacade,
    private readonly prisma: PrismaService,
    private readonly queues: BullMqQueueFactory,
    private readonly orders: OrdersRpc,
    private readonly trips: TripsRpc,
    private readonly dispatch: DispatchService,
    private readonly consoleReads: ConsoleReadService,
    private readonly routes: RoutesRpc,
  ) {}

  /**
   * Parses `Authorization: Bearer <jwt>`; a bad token yields `auth: null` plus the reason. `ip` is the
   * client address as Express resolves it (`trust proxy` decides whether X-Forwarded-For counts).
   */
  async context(authorization?: string, ip?: string | null): Promise<AppContext> {
    let auth: SessionClaims | null = null;
    let authError: ErrorCode | null = null;
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (token) {
      try {
        auth = await this.identity.verifyAccessToken(token);
      } catch (err) {
        authError = isDriverError(err) ? err.code : 'token_invalid';
      }
    }
    return {
      pricing: { quote: (req) => this.pricing.quote(req) },
      config: { city: (id) => this.config.city(id) },
      health: { db: () => this.prisma.status(), redis: () => this.queues.status() },
      identity: this.identity,
      orders: this.orders,
      trips: this.trips,
      dispatch: this.dispatch,
      ledger: this.ledger,
      routes: this.routes,
      console: this.consoleReads,
      auth,
      authError,
      client: { ip: ip ?? null },
      env: { nodeEnv: process.env['NODE_ENV'] ?? 'development' },
      now: () => new Date(),
      version: API_VERSION,
    };
  }

  mount(app: INestApplication): void {
    app.use(
      TRPC_PATH,
      createExpressMiddleware({
        router: appRouter,
        createContext: ({ req }) => this.context(req.headers.authorization, req.ip ?? req.socket.remoteAddress ?? null),
        // Clients get the Arabic envelope; the stack stays in the server log.
        onError: ({ error, path }) => {
          if (error.code === 'INTERNAL_SERVER_ERROR') this.logger.error(`${path ?? '?'}: ${error.message}`, (error.cause as Error | undefined)?.stack ?? error.stack);
        },
      }),
    );
  }
}

@Module({ imports: [PricingModule, ConfigModule, IdentityModule, OrdersModule, TripsModule, DispatchModule, LedgerModule, ConsoleModule, RoutesModule], providers: [TrpcService], exports: [TrpcService] })
export class TrpcModule {}
