/** DI tokens for the routes module's configuration and swappable hooks. */
export const ROUTES_NETWORK = Symbol('ROUTES_NETWORK');
export const ROUTES_RULES = Symbol('ROUTES_RULES');
/** Money rules (late-meter grace and cap) — the ledger's figures, so meter and posting agree. */
export const ROUTES_MONEY_RULES = Symbol('ROUTES_MONEY_RULES');
export const CHECKPOINT_WAIVER = Symbol('CHECKPOINT_WAIVER');
/** Riders' first names for the driver's manifest (identity's vault, reads logged). */
export const ROUTES_RIDER_NAMES = Symbol('ROUTES_RIDER_NAMES');

/** What the routes module needs from identity: first names, every read logged with `purpose`. */
export interface RiderNamesReader {
  firstNamesFor(personIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, string | null>>;
}

/**
 * Launch kill switches (`modules/controls`): a switched-off corridor or the intercity vertical refuses
 * new seat holds and request posts (`service_paused`). Optional: harnesses run without it.
 */
export const ROUTES_CONTROLS = Symbol('ROUTES_CONTROLS');

export interface RoutesControlsPort {
  assertCorridorOpen(input: { cityId: string; corridorId: string }): Promise<void>;
}
