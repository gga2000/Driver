export const LEDGER_REPOSITORY = Symbol('LEDGER_REPOSITORY');
/** The city's `MoneyRules` (contracts `AZIZIYAH_MONEY_RULES` until config serves them per city). */
export const MONEY_RULES = Symbol('MONEY_RULES');
export const MERCHANT_SETTINGS_REPOSITORY = Symbol('MERCHANT_SETTINGS_REPOSITORY');
export const LEDGER_EVENTS = Symbol('LEDGER_EVENTS');
export const LEDGER_INCIDENTS = Symbol('LEDGER_INCIDENTS');
/** `CapsPort` for dispatch: `isOverCap(driverId)`, `canOffer(driverId, job)`, `status(driverId)`. */
export const CAPS_PORT = Symbol('CAPS_PORT');
