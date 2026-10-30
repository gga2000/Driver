import { describe, expect, it } from 'vitest';
import { closedReportDone, closedReportFailed } from './report-closed';

describe('«الشارع مسدود قدامي» answers (N20)', () => {
  it('thanks while it waits; «counted» only when the server confirmed it', () => {
    expect(closedReportDone({ confirmed: false })).toBe('partner.report_closed_thanks');
    expect(closedReportDone({ confirmed: true })).toBe('partner.report_closed_counted');
  });

  it('maps the server errors', () => {
    expect(closedReportFailed('rate_limited', true)).toBe('partner.report_closed_limit');
    expect(closedReportFailed('invalid_input', true)).toBe('partner.report_closed_no_road');
    expect(closedReportFailed('trip_not_found', true)).toBe('partner.report_closed_no_road');
    expect(closedReportFailed('internal', true)).toBe('partner.report_closed_error');
    expect(closedReportFailed(null, true)).toBe('partner.report_closed_error');
  });

  it('no network: «ما انرسل، ماكو انترنت»', () => {
    expect(closedReportFailed(null, false)).toBe('partner.report_closed_offline');
    expect(closedReportFailed('internal', false)).toBe('partner.report_closed_offline');
  });
});
