import { apiErrorCode } from '@/lib/api-links';

/**
 * Answers that a retry cannot change (FLOW-08): an older server's hourly limit, a trip that is not
 * the person's or is long over. The sheet stops retrying and puts the emergency number first.
 */
const REFUSALS: ReadonlySet<string> = new Set(['sos_rate_limited', 'sos_not_party', 'sos_trip_over']);
export const isSosRefusal = (err: unknown): boolean => REFUSALS.has(apiErrorCode(err) ?? '');
