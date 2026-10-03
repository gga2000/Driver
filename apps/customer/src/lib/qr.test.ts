import { describe, expect, it } from 'vitest';
import { penalty, qrMatrix, qrPath } from './qr';

/** The 7×7 finder pattern: dark ring, light ring, 3×3 dark core. */
function isFinder(m: boolean[][], x0: number, y0: number): boolean {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      if (m[y0 + y]![x0 + x] !== (d !== 2)) return false;
    }
  }
  return true;
}

describe('qrMatrix', () => {
  it('a top-up payload fits version 1 (21×21) with the three finders, timing and the dark module', () => {
    const m = qrMatrix('DRVTU:482913');
    expect(m).toHaveLength(21);
    expect(isFinder(m, 0, 0) && isFinder(m, 14, 0) && isFinder(m, 0, 14)).toBe(true);
    for (let i = 8; i < 13; i++) {
      expect(m[6]![i]).toBe(i % 2 === 0);
      expect(m[i]![6]).toBe(i % 2 === 0);
    }
    expect(m[21 - 8]![8]).toBe(true);
  });

  it('format bits: both copies agree and decode to level M with a valid BCH code', () => {
    const m = qrMatrix('DRVTU:000007');
    const size = m.length;
    const first: number[] = [];
    for (let i = 0; i <= 5; i++) first.push(Number(m[i]![8]));
    first.push(Number(m[7]![8]), Number(m[8]![8]), Number(m[8]![7]));
    for (let i = 9; i < 15; i++) first.push(Number(m[8]![14 - i]));
    const second: number[] = [];
    for (let i = 0; i < 8; i++) second.push(Number(m[8]![size - 1 - i]));
    for (let i = 8; i < 15; i++) second.push(Number(m[size - 15 + i]![8]));
    expect(first).toEqual(second);
    const bits = first.reduce((a, b, i) => a | (b << i), 0) ^ 0x5412;
    expect(bits >>> 13).toBe(0); // ECC level M = 00
    let rem = bits >>> 10;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    expect(rem & 0x3ff).toBe(bits & 0x3ff);
  });

  it('keeps the lowest-penalty mask, grows the version with the payload and refuses what does not fit', () => {
    const best = qrMatrix('DRVTU:482913');
    for (let k = 0; k < 8; k++) expect(penalty(best)).toBeLessThanOrEqual(penalty(qrMatrix('DRVTU:482913', k)));
    expect(qrMatrix('x'.repeat(40))).toHaveLength(29); // version 3-M holds 42 bytes
    expect(() => qrMatrix('x'.repeat(200))).toThrow(RangeError);
  });

  it('qrPath draws one square per dark module inside a quiet zone', () => {
    const m = qrMatrix('DRVTU:1');
    const { path, size } = qrPath(m);
    expect(size).toBe(29);
    expect(path.split('M').length - 1).toBe(m.flat().filter(Boolean).length);
    expect(path.startsWith('M4 4h1v1h-1z')).toBe(true);
  });
});
