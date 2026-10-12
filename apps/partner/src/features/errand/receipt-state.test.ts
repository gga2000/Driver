import { describe, expect, it, vi } from 'vitest';

vi.mock('@driver/ui', () => ({ useNetwork: () => ({ online: true }) }));
vi.mock('@/lib/api', () => ({ useApiClient: () => null }));
vi.mock('@/lib/storage', () => ({ storage: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined } }));
vi.mock('@/features/account/photo', () => ({ uploadPhoto: async () => 'up_receipt_1' }));

const { errandBlocks, recordReceipt, receiptOf } = await import('./receipt-state');

const shops = (stopId: string, state: 'pending' | 'arrived' | 'completed' = 'arrived') => ({ stopId, type: 'pickup' as const, state, shopList: { items: [] } as never });
const photo = { uri: 'file:///r.jpg', contentType: 'image/jpeg' as const };
const client = (mutate: () => Promise<unknown>) => ({ places: { photoUpload: { mutate: vi.fn() } }, partner: { errandReceipt: { mutate } } }) as never;

describe('«دوّرلي» main button gate (errandBlocks)', () => {
  it('food, rides and parcels are never held, nor a shops stop before he arrives', () => {
    for (const vertical of ['food', 'taxi', 'tuktuk', 'parcel'] as const) expect(errandBlocks({ vertical }, shops('s_food'))).toBeNull();
    expect(errandBlocks({ vertical: 'errand' }, shops('s_early', 'pending'))).toBeNull();
    expect(errandBlocks({ vertical: 'errand' }, { stopId: 'd1', type: 'dropoff', state: 'arrived', shopList: null })).toBeNull();
    expect(errandBlocks({ vertical: 'errand' }, null)).toBeNull();
  });

  it('at the shops with no receipt it names what is missing; once sent it lets him go', async () => {
    expect(errandBlocks({ vertical: 'errand' }, shops('s_sent'))).toBe('partner.errand.receipt_first');
    const how = await recordReceipt(client(async () => ({ receiptIqd: 18_750, cashDueIqd: 23_750, overCeiling: false })), { tripId: 't1', stopId: 's_sent', totalIqd: 18_750, photo });
    expect(how).toBe('sent');
    expect(receiptOf('s_sent')).toEqual({ receiptIqd: 18_750, cashDueIqd: 23_750 });
    expect(errandBlocks({ vertical: 'errand' }, shops('s_sent'))).toBeNull();
  });

  it('no network: the receipt waits on the phone and counts as recorded', async () => {
    const offline = client(async () => {
      throw new TypeError('Network request failed');
    });
    expect(await recordReceipt(offline, { tripId: 't1', stopId: 's_queued', totalIqd: 9_000, photo })).toBe('queued');
    expect(receiptOf('s_queued')).toEqual({ receiptIqd: 9_000, cashDueIqd: null });
    expect(errandBlocks({ vertical: 'errand' }, shops('s_queued'))).toBeNull();
  });

  it('a refusal from the server is not a receipt', async () => {
    const refused = client(async () => {
      throw Object.assign(new Error('order_state_conflict'), { data: { httpStatus: 409 } });
    });
    await expect(recordReceipt(refused, { tripId: 't1', stopId: 's_refused', totalIqd: 9_000, photo })).rejects.toThrow();
    expect(errandBlocks({ vertical: 'errand' }, shops('s_refused'))).toBe('partner.errand.receipt_first');
  });
});
