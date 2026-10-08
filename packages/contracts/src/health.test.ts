import { describe, expect, it } from 'vitest';
import { LIVE_DB_GRACE_MS, liveDbGate } from './router-io.js';

describe('liveDbGate (health.live)', () => {
  const at = (ms: number) => new Date(1_800_000_000_000 + ms);

  it('rides out a short database blip', () => {
    const gate = liveDbGate();
    expect(gate.alive('unavailable', at(0))).toBe(true);
    expect(gate.alive('unavailable', at(LIVE_DB_GRACE_MS - 1))).toBe(true);
    expect(gate.alive('ok', at(LIVE_DB_GRACE_MS + 5_000))).toBe(true);
    // The clock restarts after a good answer.
    expect(gate.alive('unavailable', at(LIVE_DB_GRACE_MS + 10_000))).toBe(true);
  });

  it('fails once the database has been down for the whole grace', () => {
    const gate = liveDbGate();
    gate.alive('unavailable', at(0));
    expect(gate.alive('unavailable', at(LIVE_DB_GRACE_MS))).toBe(false);
    expect(gate.alive('ok', at(LIVE_DB_GRACE_MS + 1))).toBe(true);
  });
});
