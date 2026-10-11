import { describe, expect, it } from 'vitest';
import { csvCell, csvTime, toCsv } from './csv';

describe('CSV export', () => {
  it('quotes what needs quoting and defuses formulas', () => {
    expect(csvCell('مطعم خالد')).toBe('مطعم خالد');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell(-500)).toBe('-500');
    expect(csvCell(null)).toBe('');
    expect(csvCell('\u2066#1866\u2069')).toBe('#1866');
  });
  it('starts with a BOM and ends lines with CRLF', () => {
    expect(toCsv([['a', 1], ['b', 2]])).toBe('﻿a,1\r\nb,2\r\n');
  });
  it('writes times on Baghdad clock', () => {
    expect(csvTime(new Date('2026-10-09T18:05:00Z'))).toBe('2026-10-09 21:05');
    expect(csvTime(null)).toBe('');
  });
});
