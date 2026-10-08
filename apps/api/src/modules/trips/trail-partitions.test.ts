import { describe, expect, it } from 'vitest';
import { trailPartitionEnd } from './trips.repository.js';

describe('trail partitions by name (speed audit z1)', () => {
  it('reads where a daily or an old monthly partition ends; the default partition has no end', () => {
    expect(trailPartitionEnd('trail_points_2026_12_31')?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(trailPartitionEnd('trail_points_2026_10')?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(trailPartitionEnd('trail_points_default')).toBeNull();
    expect(trailPartitionEnd('trail_points_2026_10_01; DROP TABLE x')).toBeNull();
  });
});
