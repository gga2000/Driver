import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/index.js';
import { ConsoleModule } from '../console/index.js';
import { ControlsModule } from '../controls/index.js';
import { DispatchModule } from '../dispatch/index.js';
import { DriverAccountModule } from '../driver-account/index.js';
import { EventsModule } from '../events/index.js';
import { FleetModule } from '../fleet/index.js';
import { IdentityModule } from '../identity/index.js';
import { LedgerModule } from '../ledger/index.js';
import { OpsModule } from '../ops/index.js';
import { OrdersModule } from '../orders/index.js';
import { NotifyModule } from '../notify/index.js';
import { OrgsModule } from '../orgs/index.js';
import { PlacesModule } from '../places/index.js';
import { PromotionsModule } from '../promotions/index.js';
import { RoutesModule } from '../routes/index.js';
import { SupportModule } from '../support/index.js';
import { TripsModule } from '../trips/index.js';
import { AccountCloseService } from './account-close.service.js';
import { ApprovalsService } from './approvals.service.js';
import { ControlRoomService } from './control-room.service.js';
import { CASH_ROUND_FROM_HOUR, cashRoundFromHourEnv, FinanceDeskService } from './finance.service.js';
import { LaunchMetricsService } from './metrics.service.js';
import { MoneyOutService } from './money-out.service.js';

/**
 * Launch-week control room: the approvals queue, the nightly cash desk and the metrics wall. Owns no
 * tables: it composes the owning modules' public services (decisions go back to them) and writes the
 * console audit log through the controls module.
 */
@Module({
  imports: [
    ConfigModule,
    ConsoleModule,
    ControlsModule,
    DispatchModule,
    DriverAccountModule,
    EventsModule,
    FleetModule,
    IdentityModule,
    LedgerModule,
    NotifyModule,
    OpsModule,
    OrdersModule,
    OrgsModule,
    PlacesModule,
    PromotionsModule,
    RoutesModule,
    SupportModule,
    TripsModule,
  ],
  providers: [
    AccountCloseService,
    ApprovalsService,
    FinanceDeskService,
    LaunchMetricsService,
    MoneyOutService,
    ControlRoomService,
    // Env CASH_ROUND_FROM_HOUR (0–23, default 18): where tonight's round starts counting receipts.
    { provide: CASH_ROUND_FROM_HOUR, useFactory: () => cashRoundFromHourEnv(process.env['CASH_ROUND_FROM_HOUR']) },
  ],
  exports: [ControlRoomService, AccountCloseService],
})
export class ControlRoomModule {}
