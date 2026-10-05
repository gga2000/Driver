import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AZIZIYAH_ZONES } from '@driver/contracts';
import { FileZonesRepository, InMemoryZonesRepository } from './zones.repository.js';

const RING = [{ lat: 32.9, lng: 45.05 }, { lat: 32.9, lng: 45.07 }, { lat: 32.91, lng: 45.06 }];
const SAVE = { cityId: 'aziziyah', key: 'centre', ring: RING, centre: { lat: 32.903, lng: 45.06 }, placedById: 'p_ali', placedAt: new Date('2026-10-05T10:00:00Z') };

describe('InMemoryZonesRepository', () => {
  it('starts with every seed zone as a draft hexagon', async () => {
    const rows = await new InMemoryZonesRepository().list('aziziyah');
    expect(rows).toHaveLength(AZIZIYAH_ZONES.length);
    expect(rows.every((r) => r.placement === 'draft' && r.ring.length === 6 && r.centre === null)).toBe(true);
  });
  it('saves a placement and refuses unknown zones', async () => {
    const repo = new InMemoryZonesRepository();
    expect(await repo.savePlacement(SAVE)).toMatchObject({ key: 'centre', placement: 'placed', ring: RING, placedById: 'p_ali' });
    expect(await repo.savePlacement({ ...SAVE, key: 'atlantis' })).toBeNull();
    expect((await repo.list('aziziyah')).find((r) => r.key === 'centre')?.placement).toBe('placed');
  });
});

describe('FileZonesRepository', () => {
  it('keeps placements across restarts', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'zones-')), 'zones.json');
    await new FileZonesRepository(file).savePlacement(SAVE);
    const again = await new FileZonesRepository(file).list('aziziyah');
    expect(again.find((r) => r.key === 'centre')).toMatchObject({ placement: 'placed', ring: RING, placedAt: SAVE.placedAt });
    expect(again).toHaveLength(AZIZIYAH_ZONES.length);
  });
  it('refuses a file that is not a zone snapshot', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'zones-')), 'zones.json');
    writeFileSync(file, '{"nope":true}');
    expect(() => new FileZonesRepository(file)).toThrow(/not a zone snapshot/);
  });
});
