/**
 * A small QR encoder (ISO/IEC 18004) for the wallet top-up code: byte mode, error correction M,
 * versions 1–5 (up to 84 bytes), the lowest-penalty mask. Pure and dependency-free so the code
 * screen draws it with react-native-svg on every platform. Follows the reference construction
 * (function patterns, Reed–Solomon over GF(256)/0x11D, zigzag placement, BCH format bits).
 */

/** ECC level M per version: [total codewords, EC codewords per block, blocks] (all blocks equal for v1–5). */
const M_TABLE: Record<number, [number, number, number]> = {
  1: [26, 10, 1],
  2: [44, 16, 1],
  3: [70, 26, 1],
  4: [100, 18, 2],
  5: [134, 24, 2],
};
const ALIGN: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30] };
const REMAINDER_BITS: Record<number, number> = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7 };

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j]!, root);
      if (j + 1 < result.length) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] = result[i]! ^ gfMul(coef, factor);
    });
  }
  return result;
}

function utf8(text: string): number[] {
  return [...new TextEncoder().encode(text)];
}

/** Data + EC codewords, interleaved, for `bytes` at `version`. */
function codewords(bytes: readonly number[], version: number): number[] {
  const [total, ecPerBlock, blocks] = M_TABLE[version]!;
  const dataCount = total - ecPerBlock * blocks;
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  const capacity = dataCount * 8;
  push(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataCount; pad ^= 0xec ^ 0x11) data.push(pad);

  const perBlock = dataCount / blocks;
  const divisor = rsDivisor(ecPerBlock);
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  for (let b = 0; b < blocks; b++) {
    const block = data.slice(b * perBlock, (b + 1) * perBlock);
    dataBlocks.push(block);
    ecBlocks.push(rsRemainder(block, divisor));
  }
  const out: number[] = [];
  for (let i = 0; i < perBlock; i++) for (const blk of dataBlocks) out.push(blk[i]!);
  for (let i = 0; i < ecPerBlock; i++) for (const blk of ecBlocks) out.push(blk[i]!);
  return out;
}

const MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Penalty score (rules N1–N4) of a finished matrix; the encoder keeps the mask with the lowest. */
export function penalty(m: readonly boolean[][]): number {
  const size = m.length;
  let score = 0;
  const lines: boolean[][] = [];
  for (let y = 0; y < size; y++) lines.push([...m[y]!]);
  for (let x = 0; x < size; x++) lines.push(m.map((row) => row[x]!));
  for (const line of lines) {
    // N1: runs of five or more same-colour modules.
    let run = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) run += 1;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    // N3: finder-like 1:1:3:1:1 with four light modules on a side.
    const s = line.map((d) => (d ? '1' : '0')).join('');
    for (const pat of ['10111010000', '00001011101']) {
      let at = s.indexOf(pat);
      while (at !== -1) {
        score += 40;
        at = s.indexOf(pat, at + 1);
      }
    }
  }
  // N2: 2×2 blocks of one colour.
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const c = m[y]![x];
      if (m[y]![x + 1] === c && m[y + 1]![x] === c && m[y + 1]![x + 1] === c) score += 3;
    }
  }
  // N4: dark/light balance.
  const dark = m.reduce((a, row) => a + row.filter(Boolean).length, 0);
  const k = Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1;
  return score + Math.max(0, k) * 10;
}

/** The QR matrix (true = dark) for `text`; throws when it does not fit version 5-M. */
export function qrMatrix(text: string, forceMask?: number): boolean[][] {
  const bytes = utf8(text);
  const version = [1, 2, 3, 4, 5].find((v) => {
    const [total, ec, blocks] = M_TABLE[v]!;
    return 4 + 8 + bytes.length * 8 <= (total - ec * blocks) * 8;
  });
  if (!version) throw new RangeError('QR payload too long');
  const size = 17 + 4 * version;
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    modules[y]![x] = dark;
    fn[y]![x] = true;
  };

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const pos = ALIGN[version]!;
  pos.forEach((ay, i) => {
    pos.forEach((ax, j) => {
      const last = pos.length - 1;
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    });
  });
  const drawFormat = (mask: number) => {
    const data = (0 << 3) | mask; // ECC level M = 00
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);

  const data = codewords(bytes, version);
  const totalBits = data.length * 8 + REMAINDER_BITS[version]!;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y]![x] && i < totalBits) {
          modules[y]![x] = i < data.length * 8 ? ((data[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0 : false;
          i++;
        }
      }
    }
  }

  const masked = (mask: number): boolean[][] => {
    const out = modules.map((row, y) => row.map((d, x) => (fn[y]![x] ? d : d !== MASKS[mask]!(x, y))));
    const saved = modules.map((r) => [...r]);
    // Format bits for this mask, drawn into a copy.
    drawFormat(mask);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (fn[y]![x]) out[y]![x] = modules[y]![x]!;
    for (let y = 0; y < size; y++) modules[y] = saved[y]!;
    return out;
  };
  if (forceMask !== undefined) return masked(forceMask);
  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = masked(mask);
    const p = penalty(m);
    if (p < bestScore) {
      best = m;
      bestScore = p;
    }
  }
  return best!;
}

/** One SVG path ("M x y h1 v1 h-1 z" per dark module) for a matrix, with a quiet zone of `margin`. */
export function qrPath(m: readonly boolean[][], margin = 4): { path: string; size: number } {
  let path = '';
  m.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x + margin} ${y + margin}h1v1h-1z`;
    }),
  );
  return { path, size: m.length + margin * 2 };
}
