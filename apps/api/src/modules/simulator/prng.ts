/**
 * Seeded randomness for the simulator. Everything random in a run comes from one of these, so a
 * seed reproduces a run exactly (world, demand, every actor's choice).
 *
 * `mulberry32`: small, fast, good enough for simulation, and stable across Node versions.
 */
export interface Rand {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** Uniform real in [min, max). */
  range(min: number, max: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Picks by non-negative weights. */
  weighted<T>(items: readonly T[], weight: (t: T) => number): T;
  /** A child stream: independent of how many numbers this one draws later. */
  fork(label: string): Rand;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a label, mixed with the seed: stable sub-seeds for forked streams. */
function mix(seed: number, label: string): number {
  let h = 0x811c9dc5 ^ (seed >>> 0);
  for (let i = 0; i < label.length; i += 1) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function createRand(seed: number): Rand {
  const next = mulberry32(seed);
  const rand: Rand = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    range: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('pick from an empty list');
      return items[Math.floor(next() * items.length)]!;
    },
    weighted: (items, weight) => {
      const total = items.reduce((s, t) => s + Math.max(0, weight(t)), 0);
      if (items.length === 0 || total <= 0) throw new Error('weighted pick with no weight');
      let r = next() * total;
      for (const t of items) {
        r -= Math.max(0, weight(t));
        if (r < 0) return t;
      }
      return items[items.length - 1]!;
    },
    fork: (label) => createRand(mix(seed, label)),
  };
  return rand;
}
