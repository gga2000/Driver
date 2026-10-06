export { ControlsModule } from './controls.module.js';
/**
 * `ControlsService.assertOrderAllowed` / `assertCorridorOpen` are the gates new work passes (orders,
 * routes); `dispatchHeld` is dispatch's hold check; `bindActiveOrders` / `registerCorridors` are how
 * the orders and routes modules feed it without a cycle.
 */
export { ControlsService, daysBetween, VERTICAL_AR, DEFAULT_THROTTLE_ETA_MIN, BUSY_LOAD, BANNER_MAX_MS, throttleMessage, loadState } from './controls.service.js';
export type { OrderGate, ActiveOrdersByZone } from './controls.service.js';
export { AuditLogService, StaffNames } from './audit.js';
export { CONTROLS_REPOSITORY, InMemoryControlsRepository, PrismaControlsRepository, targetOf } from './controls.repository.js';
export type { ControlsRepository, KillSwitchRecord, ZoneCapacityRecord, BannerRecord, QuietRecord, AuditRecord } from './controls.repository.js';
