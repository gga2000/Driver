import { describe, expect, it } from 'vitest';
import {
  CLOSURE_EDIT_ROLES,
  CLOSURE_LIMITS,
  CLOSURE_READ_ROLES,
  CLOSURE_REPORT_ROLES,
  CLOSURE_REPORT_RULES,
  CloseStreetInput,
  ClosureView,
  ReportClosureInput,
} from './closures-io.js';
import { AvoidedStreet } from './closed-street.js';

const P = (i: number) => ({ lat: 32.905 + i * 0.0001, lng: 45.06 });

describe('N20 closed streets: the contracts', () => {
  it('a courier report carries only the city and why — never a place from the app', () => {
    expect(ReportClosureInput.parse({ cityId: 'aziziyah', reason: 'funeral', path: [P(0), P(1)], from: P(0), lat: 1, lng: 2 })).toEqual({ cityId: 'aziziyah', reason: 'funeral' });
    expect(ReportClosureInput.safeParse({ cityId: 'aziziyah', reason: 'party' }).success).toBe(false);
  });

  it('ops close two to 400 points, a short trimmed name, and an optional earlier hour', () => {
    expect(CloseStreetInput.safeParse({ cityId: 'aziziyah', path: [P(0)], reason: 'works' }).success).toBe(false);
    expect(CloseStreetInput.safeParse({ cityId: 'aziziyah', path: Array.from({ length: CLOSURE_LIMITS.maxPoints + 1 }, (_, i) => P(i)), reason: 'works' }).success).toBe(false);
    expect(CloseStreetInput.safeParse({ cityId: 'aziziyah', path: [P(0), P(1)], reason: 'works', nameAr: 'ش'.repeat(CLOSURE_LIMITS.nameMax + 1) }).success).toBe(false);
    const ok = CloseStreetInput.parse({ cityId: 'aziziyah', path: [P(0), P(1)], reason: 'water', nameAr: '  شارع المستشفى ', until: '2026-10-12T18:00:00Z' });
    expect(ok.nameAr).toBe('شارع المستشفى');
    expect(ok.until).toEqual(new Date('2026-10-12T18:00:00Z'));
    expect(CloseStreetInput.parse({ cityId: 'aziziyah', path: [P(0), P(1)], reason: 'other' }).nameAr).toBeNull();
  });

  it('reporting is for driving partners only; confirming is for ops, who can all see the list', () => {
    for (const r of ['courier', 'driver', 'intercity_driver', 'khat_driver'] as const) expect(CLOSURE_REPORT_ROLES).toContain(r);
    for (const r of ['customer', 'merchant_owner', 'fleet_owner', 'field_ops', 'support'] as const) expect(CLOSURE_REPORT_ROLES).not.toContain(r);
    for (const r of CLOSURE_EDIT_ROLES) expect(CLOSURE_READ_ROLES).toContain(r);
    expect(CLOSURE_EDIT_ROLES).not.toContain('support');
  });

  it('the report rules Ali approved: 40–190 m ahead, the same street within 40 m, 5 a day, 1 h repeat, 2 h to confirm', () => {
    expect(CLOSURE_REPORT_RULES).toEqual({ reportLiveMs: 2 * 3_600_000, aheadFromM: 40, aheadToM: 190, sameStreetM: 40, perDay: 5, againMs: 3_600_000 });
  });

  it('views: a Console row and a street a route went around', () => {
    const base = { id: 'cls_1', path: [P(0), P(1)], reason: 'works', nameAr: null, endsAt: '2026-10-12T21:00:00Z' };
    expect(AvoidedStreet.parse({ ...base, extraMin: 3 }).endsAt).toEqual(new Date('2026-10-12T21:00:00Z'));
    expect(AvoidedStreet.safeParse({ ...base, extraMin: -1 }).success).toBe(false);
    const row = { ...base, cityId: 'aziziyah', lengthM: 150, startsAt: '2026-10-12T09:00:00Z', closedByName: 'حيدر', openedAt: null, openedByName: null, active: true, source: 'courier', confirmed: false, confirmedByName: null };
    expect(ClosureView.parse(row)).toMatchObject({ source: 'courier', confirmed: false });
    expect(ClosureView.safeParse({ ...row, source: 'customer' }).success).toBe(false);
  });
});
