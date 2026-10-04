import type { Vertical } from '@driver/contracts';

/**
 * Launch controls as orders uses them (`modules/controls`, bound in the orders module): kill switches
 * per vertical / zone / restaurant and the per-zone capacity throttle refuse a new order before
 * anything is written (`service_paused`, `zone_at_capacity`). Optional so harnesses run without it.
 */
export interface OrdersControlsPort {
  assertOrderAllowed(gate: {
    cityId: string;
    vertical: Vertical;
    zones: ReadonlyArray<string | null | undefined>;
    customerZone: string | null;
    merchantOrgId: string | null;
    scheduledFor?: Date | null;
  }): Promise<void>;
}

export const ORDERS_CONTROLS = Symbol('ORDERS_CONTROLS');

/** Order types whose customer zone the throttle counts (couriers are the bottleneck; rides are dispatch's). */
export const THROTTLED_ORDER_TYPES: readonly string[] = ['food', 'grocery_catalog', 'errand', 'parcel'];
