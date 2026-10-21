import { describe, expect, it } from 'vitest';
import type { StaffChange } from '@driver/contracts';
import { markSeen, NEW_WINDOW_MS, parseSeen, unseenChanges } from './logic';

const now = Date.parse('2026-10-21T20:00:00Z');
const row = (id: string, at: string): StaffChange => ({ id, at: new Date(at), byFirstName: 'حيدر', summaryAr: `تعديل ${id}` });
const rows = [row('c', '2026-10-21T19:00:00Z'), row('b', '2026-10-20T10:00:00Z'), row('a', '2026-10-01T10:00:00Z')];

describe('«فريقنا عدّل بمحلك»', () => {
  it('counts what is newer than the last look, or the last week the first time', () => {
    expect(unseenChanges(rows, undefined, now).map((r) => r.id)).toEqual(['c', 'b']);
    expect(unseenChanges(rows, '2026-10-20T10:00:00.000Z', now).map((r) => r.id)).toEqual(['c']);
    expect(unseenChanges(rows, '2026-10-21T19:00:00.000Z', now)).toEqual([]);
    expect(NEW_WINDOW_MS).toBe(7 * 86_400_000);
  });

  it('marks the newest row seen, per store, and never moves the mark back', () => {
    const seen = markSeen({}, 'org1', rows);
    expect(seen).toEqual({ org1: '2026-10-21T19:00:00.000Z' });
    expect(markSeen(seen, 'org1', [rows[2]!])).toEqual(seen);
    expect(markSeen(seen, 'org2', [rows[1]!])).toEqual({ ...seen, org2: '2026-10-20T10:00:00.000Z' });
  });

  it('reads back only well-formed marks', () => {
    expect(parseSeen(JSON.stringify({ org1: '2026-10-21T19:00:00.000Z', org2: 'soon', org3: 5 }))).toEqual({ org1: '2026-10-21T19:00:00.000Z' });
    expect(parseSeen('[1]')).toEqual({});
    expect(parseSeen('{')).toEqual({});
    expect(parseSeen(null)).toEqual({});
  });
});
