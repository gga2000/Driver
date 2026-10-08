import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DriverDepartureView, GarageOpsView, IntercityNetwork, OverdueDeparture } from '@driver/contracts';
import { GarageBoard } from './garage-page';

const G = { id: 'g_main' as string, cityId: 'aziziyah', nameAr: 'كراج العزيزية', nameEn: 'Aziziyah garage', lat: 32.9, lng: 45.06, geofenceM: 150, draft: false } as const;
const NET = {
  garages: [G, { ...G, id: 'g_kut', nameAr: 'كراج الكوت' }],
  corridors: [{ id: 'c_bgd', nameAr: 'العزيزية ⇄ بغداد' }],
} as unknown as IntercityNetwork;

const dep = (id: string, hhmm: string, state: DriverDepartureView['state'], booked: number): DriverDepartureView =>
  ({
    id,
    corridorId: 'c_bgd',
    direction: 'from_aziziyah',
    garageId: G.id,
    driverId: `p_${id}`,
    vehicle: { kind: 'sedan', layout: 'sedan_4', plate: '12345 واسط', modelKey: 'elantra', model: null, color: 'بيضة', noSmoking: false, bigBags: false, ac: true },
    departAt: new Date(`2026-10-08T${hhmm}:00Z`),
    latestDepartureAt: new Date(`2026-10-08T${hhmm}:00Z`),
    state,
    familyOnly: false,
    fill: { seatsTotal: 4, booked, held: 0, walkUps: 0, walkUpsCounted: 0, filled: booked, free: 4 - booked },
    departedAt: state === 'departed' ? new Date(`2026-10-08T${hhmm}:00Z`) : null,
  }) as unknown as DriverDepartureView;

const VIEW = {
  garage: G,
  departures: [dep('no_show', '05:00', 'scheduled', 3), dep('road', '04:00', 'departed', 4), dep('done', '03:00', 'arrived', 2), dep('next', '09:00', 'scheduled', 1)],
  demand: [],
  openRequests: [],
  stranded: [],
} as unknown as GarageOpsView;

const overdue = (id: string, reason: OverdueDeparture['reason'], garageId = G.id): OverdueDeparture => ({
  departureId: id,
  corridorId: 'c_bgd',
  garageId,
  driverId: `p_${id}`,
  state: reason === 'driver_no_show' ? 'scheduled' : 'departed',
  reason,
  since: new Date('2026-10-08T06:00:00Z'),
  minutes: 24,
  riders: 3,
  actions: reason === 'driver_no_show' ? ['cancel'] : ['arrive'],
});

const render = (late: OverdueDeparture[]) =>
  renderToString(<GarageBoard view={VIEW} overdue={late} network={NET} cards={[{ departureId: 'no_show', firstName: 'حيدر' } as never]} onAct={() => undefined} onGarage={() => undefined} />);

describe('garage board', () => {
  it('pins the late cars on top, each with its one way out', () => {
    const html = render([overdue('no_show', 'driver_no_show'), overdue('road', 'not_arrived')]);
    expect(html).toContain('data-testid="late-no_show"');
    expect(html).toContain('data-testid="act-no_show"');
    expect(html).toContain('ألغِ الطلعة');
    expect(html).toContain('سجّل «وصلت»');
    expect(html).toContain('حيدر');
    expect(html.indexOf('late-no_show')).toBeLessThan(html.indexOf('run-no_show'));
  });
  it('says all is well when nobody is late, and offers close only on an arrived run', () => {
    const html = render([]);
    expect(html).toContain('كل السيارات على وقتها');
    expect(html).not.toContain('act-');
    expect(html.match(/سكّر الطلعة/g)).toHaveLength(1);
    expect(html).toContain('العزيزية ← بغداد');
    expect(html).toContain('data-testid="waits-ali"');
  });
  it('a late car from another garage links to that garage', () => {
    const html = render([overdue('elsewhere', 'driver_no_show', 'g_kut')]);
    expect(html).toContain('كراج الكوت');
  });
});
