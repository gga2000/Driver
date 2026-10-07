import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './unique-violation.js';

describe('isUniqueViolation', () => {
  it('knows Prisma model, raw-query and driver unique failures, also wrapped', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
    expect(isUniqueViolation({ code: 'P2010', meta: { code: '23505' } })).toBe(true);
    expect(isUniqueViolation({ code: 'P2010', message: 'duplicate key value violates unique constraint "places_owner_id_client_ref_key"' })).toBe(true);
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation(Object.assign(new Error('x'), { cause: { code: 'P2002' } }))).toBe(true);
  });

  it('says no to everything else', () => {
    expect(isUniqueViolation({ code: 'P2025' })).toBe(false);
    expect(isUniqueViolation({ code: 'P2010', meta: { code: '23503' }, message: 'foreign key' })).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
