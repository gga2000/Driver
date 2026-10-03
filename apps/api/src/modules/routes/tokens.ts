/** DI tokens for the routes module's configuration and swappable hooks. */
export const ROUTES_NETWORK = Symbol('ROUTES_NETWORK');
export const ROUTES_RULES = Symbol('ROUTES_RULES');
/** Money rules (late-meter grace and cap) — the ledger's figures, so meter and posting agree. */
export const ROUTES_MONEY_RULES = Symbol('ROUTES_MONEY_RULES');
export const CHECKPOINT_WAIVER = Symbol('CHECKPOINT_WAIVER');
