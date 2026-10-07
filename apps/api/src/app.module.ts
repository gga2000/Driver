import { Module } from '@nestjs/common';
import { CatalogModule } from './modules/catalog/index.js';
import { ChatModule } from './modules/chat/index.js';
import { ConfigModule } from './modules/config/index.js';
import { DispatchModule } from './modules/dispatch/index.js';
import { EtaModule } from './modules/eta/index.js';
import { EventsModule } from './modules/events/index.js';
import { IdentityModule } from './modules/identity/index.js';
import { DriverAccountModule } from './modules/driver-account/index.js';
import { KhatModule } from './modules/khat/index.js';
import { FleetModule } from './modules/fleet/index.js';
import { OpsModule } from './modules/ops/index.js';
import { PromotionsModule } from './modules/promotions/index.js';
import { MerchantAdminModule } from './modules/merchant-admin/index.js';
import { MenuPhotosModule } from './modules/menu-photos/index.js';
import { LedgerModule } from './modules/ledger/index.js';
import { NotifyModule } from './modules/notify/index.js';
import { OrdersModule } from './modules/orders/index.js';
import { OrgsModule } from './modules/orgs/index.js';
import { PartnerModule } from './modules/partner/index.js';
import { PlacesModule } from './modules/places/index.js';
import { PricingModule } from './modules/pricing/index.js';
import { RoutesModule } from './modules/routes/index.js';
import { ScoringModule } from './modules/scoring/index.js';
import { SimulatorModule } from './modules/simulator/index.js';
import { SupportModule } from './modules/support/index.js';
import { RetentionModule } from './modules/retention/index.js';
import { SafetyModule } from './modules/safety/index.js';
import { InsightsModule } from './modules/insights/index.js';
import { ReferralsModule } from './modules/referrals/index.js';
import { AccessModule } from './modules/access/index.js';
import { RideHabitsModule } from './modules/ride-habits/index.js';
import { PhoneBookingModule } from './modules/phone-booking/index.js';
import { InboxModule } from './modules/inbox/index.js';
import { OnCallModule } from './modules/on-call/index.js';
import { GarageTaxiModule } from './modules/garage-taxi/index.js';
import { ControlsModule } from './modules/controls/index.js';
import { ControlRoomModule } from './modules/control-room/index.js';
import { TripsModule } from './modules/trips/index.js';
import { TopUpsModule } from './modules/topups/index.js';
import { InfraModule } from './shared/infra.module.js';
import { TrpcModule } from './trpc/trpc.module.js';

@Module({
  imports: [
    InfraModule,
    IdentityModule,
    DriverAccountModule,
    KhatModule,
    FleetModule,
    OpsModule,
    PromotionsModule,
    TopUpsModule,
    MerchantAdminModule,
    MenuPhotosModule,
    OrgsModule,
    ConfigModule,
    PlacesModule,
    CatalogModule,
    TripsModule,
    OrdersModule,
    DispatchModule,
    PricingModule,
    EtaModule,
    LedgerModule,
    RoutesModule,
    ScoringModule,
    NotifyModule,
    SupportModule,
    RetentionModule,
    SafetyModule,
    InsightsModule,
    ReferralsModule,
    AccessModule,
    RideHabitsModule,
    PhoneBookingModule,
    OnCallModule,
    InboxModule,
    GarageTaxiModule,
    ControlsModule,
    ControlRoomModule,
    EventsModule,
    SimulatorModule,
    PartnerModule,
    ChatModule,
    TrpcModule,
  ],
})
export class AppModule {}
