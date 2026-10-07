import { describe, expect, it } from 'vitest';
import { InMemoryVehicleFacts, parseColour, parseFeatures } from './vehicle-facts.js';

describe('vehicle facts (ride step 3)', () => {
  it('drops colours and tags the contract does not know, and sorts tags in display order', () => {
    expect(parseColour('white')).toBe('white');
    expect(parseColour('أبيض')).toBeNull();
    expect(parseColour(null)).toBeNull();
    expect(parseFeatures(['child_seat', 'turbo', 'ac', 'family'])).toEqual(['ac', 'family', 'child_seat']);
    expect(parseFeatures(undefined)).toEqual([]);
  });

  it('in memory: the registered car plus his completed trips; an unknown driver gets empty facts', async () => {
    const facts = new InMemoryVehicleFacts(async (id) => (id === 'd1' ? 42 : 0));
    facts.register('d1', { vehicleClass: 'car', model: 'تويوتا كورولا', colour: 'white', confirmedFeatures: ['no_smoking', 'ac'] });
    const out = await facts.factsOf(['d1', 'd2', 'd1']);
    expect(out.size).toBe(2);
    expect(out.get('d1')).toEqual({ vehicleClass: 'car', model: 'تويوتا كورولا', colour: 'white', confirmedFeatures: ['ac', 'no_smoking'], tripCount: 42 });
    expect(out.get('d2')).toEqual({ vehicleClass: null, model: null, colour: null, confirmedFeatures: [], tripCount: 0 });
    expect((await facts.confirmedFeatures(['d1', 'd2'])).get('d1')).toEqual(['ac', 'no_smoking']);
  });
});
