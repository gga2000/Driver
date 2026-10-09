import { z } from 'zod';
import { IntercityDepartureState } from './routes-io.js';

/**
 * W3 (NTF-10 routes part, NTF-14): the Console's way out of a الرجعة departure whose driver never
 * came or never pressed «وصلت». Every action takes a written reason and leaves a `console_audit_log`
 * row. No fee is charged to the driver and no extra credit is paid to riders (M-11 is open): riders
 * are moved to the next cars exactly as on a driver cancel, and seats only settle on arrival.
 */
const Reason = z.string().trim().min(3).max(500);

export const StaffDepartureInput = z.object({ departureId: z.string().min(1), reason: Reason });
export type StaffDepartureInput = z.infer<typeof StaffDepartureInput>;

export const StaffDepartureResult = z.object({
  departureId: z.string(),
  state: IntercityDepartureState,
  /** False when the departure was already where the action leads (a replay): nothing written. */
  changed: z.boolean(),
  auditId: z.string().nullable(),
});
export type StaffDepartureResult = z.infer<typeof StaffDepartureResult>;

export const OverdueDeparturesInput = z.object({ limit: z.number().int().min(1).max(200).default(100) });
export type OverdueDeparturesInput = z.input<typeof OverdueDeparturesInput>;

export const OverdueDepartureReason = z.enum([
  /** Still scheduled/boarding past its latest departure time + `noShowAfterMin`: the driver never came. */
  'driver_no_show',
  /** Departed, past its expected arrival + `overdueAfterMin`, and no «وصلت». */
  'not_arrived',
]);
export type OverdueDepartureReason = z.infer<typeof OverdueDepartureReason>;

export const OverdueDeparture = z.object({
  departureId: z.string(),
  corridorId: z.string(),
  garageId: z.string(),
  driverId: z.string(),
  state: IntercityDepartureState,
  reason: OverdueDepartureReason,
  /** When it became overdue. */
  since: z.coerce.date(),
  minutes: z.number().int().nonnegative(),
  /** Riders still on it (booked or checked in). */
  riders: z.number().int().nonnegative(),
  actions: z.array(z.enum(['cancel', 'arrive'])),
});
export type OverdueDeparture = z.infer<typeof OverdueDeparture>;

/**
 * `routes.ops.departureDrivers`: who drives each departure, for the Console garage view, whatever its
 * state (riders' `driverCards` only show board departures and their own trips, so a departed or
 * overdue run had no name). One logged staff vault read (purpose `intercity_ops_departure`).
 */
export const StaffDepartureDriversInput = z.object({ departureIds: z.array(z.string().min(1)).min(1).max(100) });
export type StaffDepartureDriversInput = z.infer<typeof StaffDepartureDriversInput>;

export const StaffDepartureDriver = z.object({
  departureId: z.string(),
  driverId: z.string(),
  /** "حيدر ك."; null when the vault has no name. */
  displayName: z.string().nullable(),
  /** Masked number (identity's member card), never the number itself. */
  phoneMasked: z.string().nullable(),
});
export type StaffDepartureDriver = z.infer<typeof StaffDepartureDriver>;
