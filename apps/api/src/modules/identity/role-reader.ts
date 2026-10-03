import type { RoleKind } from '@driver/contracts';

/**
 * The narrow port identity offers other modules for role lookups: live (unfrozen, unrevoked) role
 * kinds of a person and nothing else — no phone, no name, no vault. The ledger reads it for cash
 * caps by role (G-80). Bound to `IdentityService` in `IdentityModule`.
 */
export interface RoleReader {
  activeRoles(personId: string): Promise<RoleKind[]>;
}

/** Registered symbol, so a consumer can resolve it without importing identity's runtime. */
export const ROLE_READER = Symbol.for('driver.identity.RoleReader');
