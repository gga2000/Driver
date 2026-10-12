/**
 * N20 «الشارع مسدود قدامي»: what the courier reads after his report. Thanks while it waits for ops or a
 * second courier; «it counts now» only when the server says it does — never that the street is closed
 * on an unconfirmed report.
 */
export type ClosedReportKey =
  | 'partner.report_closed_thanks'
  | 'partner.report_closed_counted'
  | 'partner.report_closed_offline'
  | 'partner.report_closed_limit'
  | 'partner.report_closed_no_road'
  | 'partner.report_closed_error';

export const CLOSED_REASONS = ['works', 'funeral', 'water', 'other'] as const;
export type ClosedReason = (typeof CLOSED_REASONS)[number];

/** The answer to a report that went through. */
export function closedReportDone(r: { confirmed: boolean }): ClosedReportKey {
  return r.confirmed ? 'partner.report_closed_counted' : 'partner.report_closed_thanks';
}

/** The answer to a report that failed: `code` is the API envelope's code, `online` the phone's network. */
export function closedReportFailed(code: string | null, online: boolean): ClosedReportKey {
  if (code === 'rate_limited') return 'partner.report_closed_limit';
  if (code === 'invalid_input' || code === 'trip_not_found') return 'partner.report_closed_no_road';
  return online ? 'partner.report_closed_error' : 'partner.report_closed_offline';
}
