import { describe, expect, it } from 'vitest';
import { placeFor, searchIntents, type SearchIntent } from './intents';

const kinds = (q: string) => searchIntents(q).map((i) => i.kind);
const ride = (q: string) => searchIntents(q).find((i): i is Extract<SearchIntent, { kind: 'ride' }> => i.kind === 'ride');

describe('one box for the whole town (h4, D-04)', () => {
  it('a city is a الرجعة card, outbound unless «من بغداد»', () => {
    expect(searchIntents('بغداد')).toEqual([{ kind: 'rajaa', cityId: 'baghdad', direction: 'from_aziziyah' }]);
    expect(searchIntents('الكوت')[0]).toMatchObject({ kind: 'rajaa', cityId: 'kut' });
    expect(searchIntents('لبغداد')[0]).toMatchObject({ kind: 'rajaa', cityId: 'baghdad' });
    expect(searchIntents('من بغداد')[0]).toMatchObject({ kind: 'rajaa', direction: 'to_aziziyah' });
  });

  it('the service words are الرجعة too', () => {
    expect(kinds('رجعة')).toEqual(['rajaa']);
    expect(kinds('الرجعة')).toEqual(['rajaa']);
    expect(kinds('كراج')).toEqual(['rajaa']);
  });

  it('a dish that only looks like a city stays food', () => {
    expect(searchIntents('بغدادي')).toEqual([]);
    expect(searchIntents('كباب')).toEqual([]);
  });

  it('a vehicle word is a ride row, with no destination when none is said', () => {
    expect(ride('تكسي')).toEqual({ kind: 'ride', vertical: 'taxi', to: null });
    expect(ride('تاكسي')?.vertical).toBe('taxi');
    expect(ride('تكتك')?.vertical).toBe('tuktuk');
  });

  it('fills the destination from what follows the vehicle («للسوق», «لشارع 30», «الى جسر حواس»)', () => {
    expect(ride('تكسي للسوق')?.to).toMatchObject({ kind: 'landmark', id: 'landmark:garage_souq', zoneId: 'centre' });
    expect(ride('تكتك لشارع ٣٠')?.to).toMatchObject({ kind: 'zone', zoneId: 'street_30', title: 'شارع 30' });
    expect(ride('تكسي الى جسر حواس')?.to?.zoneId).toBe('hawas_bridge');
    expect(ride('تكسي لمكان ما نعرفه')?.to).toBeNull();
  });

  it('a zone or landmark said exactly is «تكسي لـ…»; a loose word is not', () => {
    expect(ride('شارع ٣٠')?.to?.zoneId).toBe('street_30');
    expect(ride('الهاشمي')?.to?.zoneId).toBe('hashimi');
    expect(ride('مطعم')).toBeUndefined();
    expect(placeFor('مطعم', true)).toBeNull();
  });

  it('meal words become dish words and kitchen tags', () => {
    const [meal] = searchIntents('فطور');
    expect(meal).toMatchObject({ kind: 'meal', meal: 'breakfast', tags: ['breakfast', 'pacha'] });
    expect(meal?.kind === 'meal' && meal.words).toContain('باچة');
    expect(searchIntents('ريوگ')[0]).toMatchObject({ meal: 'breakfast' });
    expect(searchIntents('غدا')[0]).toMatchObject({ meal: 'lunch' });
    expect(searchIntents('عشا')[0]).toMatchObject({ meal: 'dinner' });
    expect(searchIntents('حلويات')[0]).toMatchObject({ meal: 'sweet' });
  });

  it('coming-soon words open the sheet; «سوق» also offers the ride to the market garage', () => {
    expect(kinds('خضرة')).toEqual(['soon']);
    expect(searchIntents('مدرسة')).toEqual([{ kind: 'soon', service: 'khat' }]);
    expect(searchIntents('طرد')).toEqual([{ kind: 'soon', service: 'parcel' }]);
    expect(kinds('سوق').sort()).toEqual(['ride', 'soon']);
    expect(kinds('تكسي للسوق')).toEqual(['ride']);
  });

  it('nothing for a word the town does not have', () => {
    expect(searchIntents('بيتزا')).toEqual([]);
    expect(searchIntents('   ')).toEqual([]);
  });
});
