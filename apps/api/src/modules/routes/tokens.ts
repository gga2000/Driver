/** DI tokens for the routes module's configuration and swappable hooks. */
export const ROUTES_NETWORK = Symbol('ROUTES_NETWORK');
export const ROUTES_RULES = Symbol('ROUTES_RULES');
/** Money rules (late-meter grace and cap) — the ledger's figures, so meter and posting agree. */
export const ROUTES_MONEY_RULES = Symbol('ROUTES_MONEY_RULES');
export const CHECKPOINT_WAIVER = Symbol('CHECKPOINT_WAIVER');
/** Riders' first names for the driver's manifest (identity's vault, reads logged). */
export const ROUTES_RIDER_NAMES = Symbol('ROUTES_RIDER_NAMES');

/**
 * What the routes module needs from identity, every read logged with `purpose`: riders' first names
 * (the driver's manifest) and a driver's member card (name and masked number) for ops staff.
 */
export interface RiderNamesReader {
  firstNamesFor(personIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, string | null>>;
  memberCards(personIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, { name: string | null; phoneMasked: string }>>;
  /**
   * Drivers' APPROVED main photos (Ali, 2026-10-06) as short-lived signed URLs, by person; people
   * without one are left out. Logged vault reads. Optional for fakes (then every card draws the initial).
   */
  driverPhotoUrls?(personIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, string>>;
}

/**
 * Launch kill switches (`modules/controls`): a switched-off corridor or the intercity vertical refuses
 * new seat holds and request posts (`service_paused`). Optional: harnesses run without it.
 */
export const ROUTES_CONTROLS = Symbol('ROUTES_CONTROLS');

export interface RoutesControlsPort {
  assertCorridorOpen(input: { cityId: string; corridorId: string }): Promise<void>;
}

/**
 * Masked calls from a driver to his riders (garage mode "اتصل"): the chat module's call bridge — a
 * platform number in production, the other party's own number only in development. Optional:
 * without it every call is refused with `call_unavailable`.
 */
export const ROUTES_CALLS = Symbol('ROUTES_CALLS');

export interface RoutesCallPort {
  open(req: { callId: string; orderId: string; callerId: string; calleeId: string }, now: Date): Promise<{ mode: 'proxy' | 'dev_direct'; dial: string; expiresAt: Date }>;
}

/**
 * Points a completed seat earned (joy r2: «+15 نقطة» on the safe-arrival card), read from the ledger
 * where `seat.completed` posted them (`seat:<bookingId>.<seat>:points`); null until they are posted.
 */
export const ROUTES_POINTS = Symbol('ROUTES_POINTS');

export interface RoutesPointsReader {
  pointsForBooking(riderId: string, bookingId: string): Promise<number | null>;
}
