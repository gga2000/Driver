import { describe, expect, it } from 'vitest';
import type { PublishedEvent } from '../events/index.js';
import type { NotifyLookups } from './notify.lookups.js';
import { dishPotEventId, NOTIFY_EVENT_TYPES, requestsFor } from './notify.subscribers.js';
import { notifyHarness } from './test-harness.js';

/** 12:00 Baghdad, Thursday 8 Oct 2026. */
const NOON = '2026-10-08T09:00:00Z';

function potPosted(over: Record<string, unknown> = {}, id = 'ev-pot-1'): PublishedEvent {
  const at = new Date(NOON);
  return {
    id,
    outboxId: 'ob1',
    type: 'catalog.pot_posted',
    actorId: 'staff',
    occurredAt: at,
    recordedAt: at,
    payload: { merchantOrgId: 'org_k', itemId: 'bamia', dishName: 'تمن وبامية', restaurantName: 'مشويات الحاج كريم', localDate: '2026-10-08', followerIds: ['fan_1', 'fan_2', 'fan_1'], ...over },
    aggregate: 'org',
    aggregateId: 'org_k',
    skewMs: 0,
    flagged: false,
    quarantined: false,
  };
}

const lookups = {} as NotifyLookups;

describe('«قدر اليوم» push (joy h2)', () => {
  it('the subscriber listens for posted pots and asks for one push per follower, keyed by the day', async () => {
    expect(NOTIFY_EVENT_TYPES).toContain('catalog.pot_posted');
    const h = notifyHarness({ start: NOON });
    const reqs = await requestsFor(potPosted(), { engine: h.engine, repo: h.repo, lookups, receiptBaseUrl: 'https://driver.iq/r' });
    expect(reqs).toEqual([
      { eventId: 'dish_pot:2026-10-08', template: 'dish_pot_today', to: 'fan_1', params: { restaurant: 'مشويات الحاج كريم', dish: 'تمن وبامية', merchantOrgId: 'org_k' }, data: { merchantOrgId: 'org_k', itemId: 'bamia' } },
      { eventId: 'dish_pot:2026-10-08', template: 'dish_pot_today', to: 'fan_2', params: { restaurant: 'مشويات الحاج كريم', dish: 'تمن وبامية', merchantOrgId: 'org_k' }, data: { merchantOrgId: 'org_k', itemId: 'bamia' } },
    ]);
  });

  it('sends it with the restaurant link, at most once a day per person, without the offers opt-in', async () => {
    const h = notifyHarness({ start: NOON });
    await h.register('fan');
    const req = { eventId: dishPotEventId('2026-10-08'), template: 'dish_pot_today' as const, to: 'fan', params: { restaurant: 'مشويات الحاج كريم', dish: 'تمن وبامية', merchantOrgId: 'org_k' } };
    await h.service.dispatch(req);
    // Another kitchen cooks another followed dish the same day: nothing more.
    expect(await h.service.dispatch({ ...req, params: { restaurant: 'مطعم المسافر', dish: 'دولمة', merchantOrgId: 'org_m' } })).toEqual([]);
    await h.run();
    const rows = await h.rows({ personId: 'fan' });
    expect(rows.map((r) => [r.template, r.status])).toEqual([['dish_pot_today', 'sent']]);
    expect(rows[0]?.payload.title).toBe('اليوم مشويات الحاج كريم طابخين تمن وبامية');
    // Not an offer: the weekly cap of offers does not count it.
    expect(await h.repo.countMarketingSince('fan', new Date('2026-10-01T00:00:00Z'))).toBe(0);
  });

  it('the person can switch them all off', async () => {
    const h = notifyHarness({ start: NOON });
    await h.register('fan');
    await h.service.setPreferences(h.actor('fan'), { dishPots: false });
    const [row] = await h.service.dispatch({ eventId: dishPotEventId('2026-10-08'), template: 'dish_pot_today', to: 'fan', params: { restaurant: 'ر', dish: 'د', merchantOrgId: 'org_k' } });
    expect(row).toMatchObject({ status: 'suppressed', reason: 'preference:dishPots' });
  });

  it('is silent on a quiet day and waits for the morning in quiet hours', async () => {
    const quiet = notifyHarness({ start: NOON, quietDay: async () => true });
    await quiet.register('fan');
    const [held] = await quiet.service.dispatch({ eventId: dishPotEventId('2026-10-08'), template: 'dish_pot_today', to: 'fan', params: { restaurant: 'ر', dish: 'د', merchantOrgId: 'org_k' } });
    expect(held).toMatchObject({ status: 'suppressed', reason: 'quiet_day' });

    const night = notifyHarness({ start: '2026-10-08T21:00:00Z' }); // 00:00 Baghdad
    await night.register('fan');
    const [later] = await night.service.dispatch({ eventId: dishPotEventId('2026-10-09'), template: 'dish_pot_today', to: 'fan', params: { restaurant: 'ر', dish: 'د', merchantOrgId: 'org_k' } });
    expect(later).toMatchObject({ status: 'deferred', reason: 'quiet_hours' });
  });

  it('nothing without the day or the kitchen', async () => {
    const h = notifyHarness({ start: NOON });
    const d = { engine: h.engine, repo: h.repo, lookups, receiptBaseUrl: 'https://driver.iq/r' };
    expect(await requestsFor(potPosted({ localDate: null }), d)).toEqual([]);
    expect(await requestsFor(potPosted({ followerIds: [] }), d)).toEqual([]);
  });
});
