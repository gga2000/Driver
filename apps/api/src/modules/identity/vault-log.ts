import { Logger } from '@nestjs/common';

/**
 * Who read the vault (vault_accessor_fk: CRIT2-01, LOAD-02, CRIT2-02, CRIT2-03). Most readers are
 * people (a courier, a staff member, the person himself), but the system reads too: the notify engine
 * (`system:notify`), safety (`system:safety`), the خطوط pager (`system:khat`), a share-trip link
 * (`share:<linkId>`), an SOS link (`sos_link:<incidentId>`). The access log's `accessor_id` is a
 * foreign key to people, so a synthetic reader is written as its kind and ref with a null accessor_id.
 */
export type AccessorKind = 'person' | 'system' | 'share_link' | 'sos_link' | 'synthetic';

export interface Accessor {
  kind: AccessorKind;
  /** The reader's person id (kind 'person'), else null. */
  personId: string | null;
  /** A synthetic reader's id as the code names it ("system:notify"), else null. */
  ref: string | null;
}

/** Person ids never hold a colon (cuids); every synthetic reader's id does ("system:notify", "share:<id>"). */
export function accessorOf(accessorId: string): Accessor {
  const colon = accessorId.indexOf(':');
  if (colon < 0) return { kind: 'person', personId: accessorId, ref: null };
  const prefix = accessorId.slice(0, colon);
  const kind: AccessorKind = prefix === 'system' ? 'system' : prefix === 'share' ? 'share_link' : prefix === 'sos_link' ? 'sos_link' : 'synthetic';
  return { kind, personId: null, ref: accessorId };
}

/**
 * Interactive staff reads in the Console (by the purpose the caller logs): these fail CLOSED — when the
 * access log row cannot be written, the read returns no data (it throws). Every other read fails open
 * (the log failure is swallowed, counted and logged, so an SOS, a notification or a share page never
 * dies on its audit row). Add a purpose here when a new Console screen reads names or numbers.
 */
export const STAFF_READ_PURPOSES: ReadonlySet<string> = new Set([
  'console_names',
  'console_driver_search',
  'console_staff',
  'document_review',
  'safety_desk',
  'safety_incident',
  'khat_sweep_alert',
  'intercity_pin_alert',
  'ride_start_code_alert',
  'support_case',
  'support_queue',
  'phone_booking_caller',
  'phone_booking_list',
  'ops_cash_round',
  'finance_cash_desk',
  'approvals_queue',
]);

/** The stable code an alert matches on (plan §7.4: alert when the count is above 0). */
export const VAULT_LOG_FAILED = 'vault_log_write_failed';

/** Thrown by a fail-closed (staff) read whose access log row could not be written. */
export class VaultLogWriteError extends Error {
  readonly code = VAULT_LOG_FAILED;

  constructor(cause: unknown) {
    super(`${VAULT_LOG_FAILED}: ${(cause as Error)?.message ?? String(cause)}`, { cause });
    this.name = 'VaultLogWriteError';
  }
}

const logger = new Logger('VaultAccessLog');
let swallowed = 0;

/** How many vault reads went ahead without their access log row since the process started. */
export function swallowedVaultLogFailures(): number {
  return swallowed;
}

/** Counts and logs one swallowed log failure (fail-open read): an error line with the stable code. */
export function recordSwallowedVaultLogFailure(err: unknown, entry: { personId: string; accessorId: string; purpose: string }): void {
  swallowed += 1;
  logger.error(`${VAULT_LOG_FAILED} count=${swallowed} purpose=${entry.purpose} accessor=${accessorOf(entry.accessorId).kind}: ${(err as Error)?.message ?? String(err)}`);
}
