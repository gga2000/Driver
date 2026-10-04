import { Injectable, Logger, Module, type INestApplication } from '@nestjs/common';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { isDriverError, type AppContext, type ErrorCode, type SessionClaims } from '@driver/contracts';
import { appRouter } from '@driver/contracts/router';
import { ConfigModule, ConfigService } from '../modules/config/index.js';
import { ConsoleModule, ConsoleReadService } from '../modules/console/index.js';
import { DispatchModule, DispatchService } from '../modules/dispatch/index.js';
import { IdentityModule, IdentityService } from '../modules/identity/index.js';
import { DriverAccountModule, DriverAccountService } from '../modules/driver-account/index.js';
import { KhatModule, KhatService } from '../modules/khat/index.js';
import { FleetModule, FleetService } from '../modules/fleet/index.js';
import { OpsModule, OpsService } from '../modules/ops/index.js';
import { MerchantAdminModule, MerchantAdminService } from '../modules/merchant-admin/index.js';
import { OrdersModule, OrdersRpc } from '../modules/orders/index.js';
import { PartnerModule, PartnerService } from '../modules/partner/index.js';
import { CustomerWalletService, LedgerFacade, LedgerModule } from '../modules/ledger/index.js';
import { HouseholdsRpc, OrgsModule } from '../modules/orgs/index.js';
import { PlacesModule, PlacesRpc } from '../modules/places/index.js';
import { PricingModule, PricingService } from '../modules/pricing/index.js';
import { RoutesModule, RoutesRpc } from '../modules/routes/index.js';
import { ShareLinksService, TrackingModule, TrackingService } from '../modules/tracking/index.js';
import { ChatModule, ChatService } from '../modules/chat/index.js';
import { TripsModule, TripsRpc } from '../modules/trips/index.js';
import { CatalogRpc } from '../modules/catalog/index.js';
import { MerchantModule, MerchantService } from '../modules/merchant/index.js';
import { TopUpsModule, TopUpService } from '../modules/topups/index.js';
import { ControlsModule, ControlsService } from '../modules/controls/index.js';
import { ControlRoomModule, ControlRoomService } from '../modules/control-room/index.js';
import { SupportModule, SupportService } from '../modules/support/index.js';
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
    private readonly driverAccount: DriverAccountService,
    private readonly khat: KhatService,
    private readonly fleet: FleetService,
    private readonly ops: OpsService,
    private readonly merchantAdmin: MerchantAdminService,
    private readonly ledger: LedgerFacade,
    private readonly prisma: PrismaService,
    private readonly queues: BullMqQueueFactory,
    private readonly orders: OrdersRpc,
    private readonly trips: TripsRpc,
    private readonly dispatch: DispatchService,
    private readonly consoleReads: ConsoleReadService,
    private readonly routes: RoutesRpc,
    private readonly catalog: CatalogRpc,
    private readonly tracking: TrackingService,
    private readonly places: PlacesRpc,
    private readonly wallet: CustomerWalletService,
    private readonly households: HouseholdsRpc,
    private readonly partner: PartnerService,
    private readonly merchant: MerchantService,
    private readonly topups: TopUpService,
    private readonly chat: ChatService,
    private readonly shareLinks: ShareLinksService,
    private readonly controls: ControlsService,
    private readonly controlRoom: ControlRoomService,
    private readonly support: SupportService,
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
      driverAccount: this.driverAccount,
      khat: this.khat,
      fleet: this.fleet,
      ops: this.ops,
      merchantAdmin: this.merchantAdmin,
      orders: this.orders,
      trips: this.trips,
      dispatch: this.dispatch,
      ledger: this.ledger,
      routes: this.routes,
      catalog: this.catalog,
      console: this.consoleReads,
      tracking: this.tracking,
      places: this.places,
      wallet: this.wallet,
      topups: this.topups,
      households: this.households,
      partner: this.partner,
      merchant: this.merchant,
      chat: this.chat,
      trackingShare: this.shareLinks,
      controls: this.controls,
      controlRoom: this.controlRoom,
      support: this.support,
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

@Module({ imports: [PricingModule, ConfigModule, IdentityModule, DriverAccountModule, KhatModule, FleetModule, OpsModule, MerchantAdminModule, OrdersModule, TripsModule, DispatchModule, LedgerModule, ConsoleModule, RoutesModule, TrackingModule, PlacesModule, OrgsModule, PartnerModule, MerchantModule, TopUpsModule, ChatModule, ControlsModule, ControlRoomModule, SupportModule], providers: [TrpcService], exports: [TrpcService] })
export class TrpcModule {}
