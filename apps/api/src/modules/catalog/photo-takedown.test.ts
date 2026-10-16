import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import { InMemoryCatalogRepository } from './catalog.repository.js';
import { CatalogService } from './catalog.service.js';

describe('CatalogService.takeDownShopPhoto (p4, Console «انزّلها»)', () => {
  it('clears a pending shop photo once, only the version staff saw', async () => {
    const clock = new FakeClock('2026-10-09T08:00:00Z');
    const catalog = new CatalogService(new InMemoryCatalogRepository(), clock);
    const item = await catalog.addItem({ orgId: 'org_k', nameAr: 'تكة', priceIqd: 2500 });
    await catalog.replacePhoto('org_k', item.id, 'upload:up_old', undefined, null, true);
    const seen = new Date(clock.now());
    clock.advance(60_000);
    await catalog.replacePhoto('org_k', item.id, 'upload:up_new', undefined, null, true);

    // A newer upload since staff looked wins: nothing taken down.
    expect(await catalog.takeDownShopPhoto(item.id, seen)).toBeNull();
    expect((await catalog.photoReviewQueue()).map((i) => i.photoUrl)).toEqual(['upload:up_new']);

    const down = await catalog.takeDownShopPhoto(item.id, new Date(clock.now()));
    expect(down).toMatchObject({ id: item.id, photoUrl: null, photoReviewPendingAt: null });
    expect(await catalog.photoReviewQueue()).toEqual([]);
    expect(await catalog.takeDownShopPhoto(item.id, new Date(clock.now()))).toBeNull();
  });
});
