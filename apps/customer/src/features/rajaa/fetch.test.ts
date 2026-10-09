import { describe, expect, it } from 'vitest';
import { FETCH_TYPED, fetchOptions, fetchPick, fetchRiderInput } from './fetch';

const trusted = [{ name: 'أختي زينب', phoneMasked: '0770 ••• ••12' }];
const household = { id: 'hh1', members: [{ personId: 'me', isMe: true, name: 'علي', phoneMasked: '0770 ••• ••01' }, { personId: 'p_mum', isMe: false, name: 'ماما', phoneMasked: '0770 ••• ••02' }] };

describe('«جيب واحد»: who the car fetches (k2)', () => {
  it('offers trusted people and the household (not himself), never «إلي»', () => {
    const options = fetchOptions(trusted as never, household as never);
    expect(options.map((o) => o.name)).toEqual(['أختي زينب', 'ماما']);
    expect(options.map((o) => o.id)).not.toContain('me');
  });

  it('turns each pick into what the server resolves', () => {
    const options = fetchOptions(trusted as never, household as never);
    const zainab = fetchPick(options[0]!.id, options, '', '');
    expect(zainab && 'pick' in zainab && fetchRiderInput(zainab.pick)).toEqual({ from: 'trusted', index: 0 });
    const mum = fetchPick(options[1]!.id, options, '', '');
    expect(mum && 'pick' in mum && fetchRiderInput(mum.pick)).toEqual({ from: 'household', householdId: 'hh1', personId: 'p_mum' });
    const typed = fetchPick(FETCH_TYPED, options, ' ماما ', '0770 123 4567');
    expect(typed && 'pick' in typed && fetchRiderInput(typed.pick)).toEqual({ from: 'typed', name: 'ماما', phone: '+9647701234567' });
  });

  it('says which typed field to fix, and nothing while no chip is picked', () => {
    expect(fetchPick(FETCH_TYPED, [], '', '123')).toEqual({ errors: ['name', 'phone'] });
    expect(fetchPick(null, [], '', '')).toBeNull();
    expect(fetchPick('trusted:5', [], '', '')).toBeNull();
  });
});
