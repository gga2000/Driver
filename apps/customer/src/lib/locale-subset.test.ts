import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { keyRefs, pickMessages } = require('../../scripts/locale-subset.cjs') as {
  keyRefs: (src: string, into: { exact: Set<string>; prefixes: Set<string> }) => { exact: Set<string>; prefixes: Set<string> };
  pickMessages: (m: Record<string, string>, refs: { exact: Set<string>; prefixes: Set<string> }) => Record<string, string>;
};

describe('customer locale subset (speed s1)', () => {
  const table = {
    'ride.vehicle_taxi': 'تكسي',
    'ride.anything_built_at_run_time': 'x',
    'console.apr_all': 'كل الطلبات',
    'partner.status_online': 'شغّال',
    'partner.vehicle_tuktuk': 'تكتك',
    'wa.khat_dropped': 'وصل',
    'partner.count_one': 'واحد',
  };
  it('keeps every customer namespace whole and drops what only other apps show', () => {
    const refs = keyRefs("t('partner.status_online'); t(`partner.vehicle_${v}`); tp('partner.count', n)", { exact: new Set(), prefixes: new Set() });
    expect(Object.keys(pickMessages(table, refs)).sort()).toEqual(['partner.count_one', 'partner.status_online', 'partner.vehicle_tuktuk', 'ride.anything_built_at_run_time', 'ride.vehicle_taxi']);
  });
});
