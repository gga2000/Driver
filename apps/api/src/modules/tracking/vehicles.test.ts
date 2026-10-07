import { describe, expect, it } from 'vitest';
import { courierVehicleFromRow, InMemoryCourierVehicles, vehicleLabel } from './vehicles.js';

describe('the courier card vehicle (ride step 3: d1, n1, n2)', () => {
  it('labels the car by model and the colour’s Iraqi name; no model, no label', () => {
    expect(vehicleLabel('Toyota Corolla', 'white')).toBe('Toyota Corolla · أبيض');
    expect(vehicleLabel('Kia Rio', 'maroon')).toBe('Kia Rio · جوزي');
    expect(vehicleLabel('Bajaj RE', null)).toBe('Bajaj RE');
    expect(vehicleLabel(null, 'silver')).toBeNull();
  });

  it('reads a registry row: confirmed features only, in display order; unknown values dropped', () => {
    const v = courierVehicleFromRow({ class: 'car', plate: 'واسط 31207', model: ' Hyundai Elantra ', colour: 'silver', featuresConfirmed: ['family', 'teleporter', 'ac'] });
    expect(v).toEqual({ vehicleClass: 'car', plate: 'واسط 31207', model: 'Hyundai Elantra', colour: 'silver', label: 'Hyundai Elantra · فضي', features: ['ac', 'family'] });
    expect(courierVehicleFromRow({ class: 'tuktuk', plate: 'واسط 777', model: null, colour: 'pink', featuresConfirmed: [] })).toMatchObject({ colour: null, label: null, features: [] });
  });

  it('the in-process registry builds the same label and hands out copies', async () => {
    const reg = new InMemoryCourierVehicles();
    reg.register('d1', { vehicleClass: 'car', plate: 'واسط 1', model: 'Hyundai Sonata', colour: 'black', features: ['no_smoking', 'heating'] });
    const v = (await reg.forCourier('d1'))!;
    expect(v).toMatchObject({ label: 'Hyundai Sonata · أسود', features: ['heating', 'no_smoking'] });
    v.features.push('ac');
    expect((await reg.forCourier('d1'))!.features).toEqual(['heating', 'no_smoking']);
  });
});
