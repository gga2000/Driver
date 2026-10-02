import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../prisma/schema.prisma'), 'utf8');
const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1]!, body: m[2]! }));

/** Spec §5 domain model, plus the outbox the spec mandates in §4. */
const REQUIRED = [
  'Person', 'Role', 'Org', 'OrgMember', 'Vehicle', 'City', 'Zone', 'Place', 'PlacePhoto', 'CatalogItem',
  'Trip', 'Stop', 'Route', 'Seat', 'Quote', 'QuoteComponent', 'LedgerEvent', 'Event', 'Outbox',
];

describe('prisma schema', () => {
  it('declares every model from the spec', () => {
    const names = models.map((m) => m.name);
    for (const r of REQUIRED) expect(names, `missing model ${r}`).toContain(r);
  });

  it('uses postgres with the postgis extension', () => {
    expect(schema).toMatch(/provider\s*=\s*"postgresql"/);
    expect(schema).toMatch(/extensions\s*=\s*\[postgis\]/);
    expect(schema).toMatch(/previewFeatures\s*=\s*\["postgresqlExtensions"\]/);
  });

  it('every model has created_at and updated_at', () => {
    for (const m of models) {
      expect(m.body, `${m.name} lacks created_at`).toMatch(/@map\("created_at"\)/);
      expect(m.body, `${m.name} lacks updated_at`).toMatch(/@updatedAt @map\("updated_at"\)/);
    }
  });

  it('ids default to cuid except the human-keyed City', () => {
    for (const m of models) {
      if (m.name === 'City') continue;
      expect(m.body, `${m.name} id is not cuid`).toMatch(/@id @default\(cuid\(\)\)/);
    }
  });

  it('IQD amounts are integers, never floats or decimals', () => {
    const iqdFields = [...schema.matchAll(/^\s+(\w+)\s+(\w+)\s+@map\("(\w+_iqd)"\)/gm)];
    expect(iqdFields.length).toBeGreaterThan(0);
    for (const f of iqdFields) expect(f[2], `${f[3]} must be Int`).toBe('Int');
    expect(schema).not.toMatch(/\bFloat\b.*iqd/i);
    expect(schema).not.toMatch(/\bDecimal\b/);
  });

  it('ledger events carry both occurred_at and recorded_at', () => {
    const ledger = models.find((m) => m.name === 'LedgerEvent')!.body;
    expect(ledger).toMatch(/occurred_at/);
    expect(ledger).toMatch(/recorded_at/);
    expect(ledger).toMatch(/idempotency_key/);
  });
});
