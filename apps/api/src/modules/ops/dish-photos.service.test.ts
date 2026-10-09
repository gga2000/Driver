import { describe, expect, it } from 'vitest';
import type { Actor } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { NoDatabaseRunner, UnitOfWork } from '../../shared/db/unit-of-work.js';
import { CatalogService, InMemoryCatalogRepository } from '../catalog/index.js';
import { AuditLogService, InMemoryControlsRepository, StaffNames } from '../controls/index.js';
import type { IdentityService } from '../identity/index.js';
import { OrgsService } from '../orgs/index.js';
import type { BlobStore } from '../places/index.js';
import { DISH_PHOTO_AUDIT, OpsDishPhotosService } from './dish-photos.service.js';

const ZAINAB: Actor = { personId: 'p_zainab', sessionId: 's1' };

/** A real in-memory catalog, orgs and audit log; signed links are `/files/<id>?sig=x`. */
async function setup() {
  const clock = new FakeClock('2026-10-09T07:00:00Z');
  const catalog = new CatalogService(new InMemoryCatalogRepository(), clock);
  const orgs = new OrgsService(undefined, clock);
  const khalid = await orgs.create({ type: 'restaurant', name: 'مطعم خالد', cityId: 'aziziyah', ownerId: 'p_owner' });
  const kut = await orgs.create({ type: 'restaurant', name: 'مطعم الكوت', cityId: 'kut', ownerId: 'p_kut' });
  const blobs = { readUrl: (id: string) => `/files/${id}?sig=x` } as unknown as BlobStore;
  const auditRepo = new InMemoryControlsRepository();
  const identity = { firstNamesFor: async (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, id === ZAINAB.personId ? 'زينب' : null])) } as unknown as IdentityService;
  const audits = new AuditLogService(auditRepo, new StaffNames(identity, clock), clock);
  const svc = new OpsDishPhotosService(catalog, orgs, audits, new UnitOfWork(new NoDatabaseRunner()), blobs);
  const dish = async (orgId: string, nameAr: string) => catalog.addItem({ orgId, nameAr, priceIqd: 6000 });
  return { clock, catalog, khalid, kut, svc, audits, dish };
}

describe('OpsDishPhotosService — p4 same-day look (Ali 2026-10-08)', () => {
  it('lists the city’s shop photos oldest first with store, dish and a signed link; Driver’s own photos never wait', async () => {
    const h = await setup();
    const tikka = await h.dish(h.khalid.id, 'تكة');
    const kebab = await h.dish(h.khalid.id, 'كباب');
    const masgouf = await h.dish(h.kut.id, 'مسكوف');
    const team = await h.dish(h.khalid.id, 'قوزي');
    await h.catalog.replacePhoto(h.khalid.id, kebab.id, 'upload:up_kebab', undefined, null, true);
    h.clock.advance(60_000);
    await h.catalog.replacePhoto(h.khalid.id, tikka.id, 'upload:up_tikka', undefined, null, true);
    await h.catalog.replacePhoto(h.kut.id, masgouf.id, 'upload:up_masgouf', undefined, null, true);
    await h.catalog.replacePhoto(h.khalid.id, team.id, 'upload:up_team');

    const rows = await h.svc.queue(ZAINAB, { cityId: 'aziziyah' });
    expect(rows).toEqual([
      { itemId: kebab.id, merchantOrgId: h.khalid.id, storeName: 'مطعم خالد', dishName: 'كباب', priceIqd: 6000, photoUrl: '/files/up_kebab?sig=x', pendingSince: new Date('2026-10-09T07:00:00Z') },
      { itemId: tikka.id, merchantOrgId: h.khalid.id, storeName: 'مطعم خالد', dishName: 'تكة', priceIqd: 6000, photoUrl: '/files/up_tikka?sig=x', pendingSince: new Date('2026-10-09T07:01:00Z') },
    ]);
    expect((await h.svc.queue(ZAINAB, { cityId: 'kut' })).map((r) => r.dishName)).toEqual(['مسكوف']);
  });

  it('«تمام» clears the photo once, with an audit row saying who; a second tap finds it gone', async () => {
    const h = await setup();
    const tikka = await h.dish(h.khalid.id, 'تكة');
    await h.catalog.replacePhoto(h.khalid.id, tikka.id, 'upload:up_tikka', undefined, null, true);
    const [row] = await h.svc.queue(ZAINAB, { cityId: 'aziziyah' });

    expect(await h.svc.keep(ZAINAB, { merchantOrgId: h.khalid.id, itemId: tikka.id, pendingSince: row!.pendingSince })).toEqual({ itemId: tikka.id, outcome: 'kept' });
    expect(await h.svc.queue(ZAINAB, { cityId: 'aziziyah' })).toEqual([]);
    const [audit] = await h.audits.list({ subjectKind: DISH_PHOTO_AUDIT.subjectKind, subjectId: h.khalid.id, limit: 5 });
    expect(audit).toMatchObject({ action: DISH_PHOTO_AUDIT.action, actorName: 'زينب', summary_ar: 'راجع صورة «تكة» من مطعم خالد وخلّاها', detail: { itemId: tikka.id } });
    // The photo itself stays on the menu.
    expect((await h.catalog.itemsOf(h.khalid.id, [tikka.id]))[0]!.photoUrl).toBe('upload:up_tikka');

    expect(await h.svc.keep(ZAINAB, { merchantOrgId: h.khalid.id, itemId: tikka.id, pendingSince: row!.pendingSince })).toEqual({ itemId: tikka.id, outcome: 'gone' });
    expect(await h.audits.list({ subjectKind: DISH_PHOTO_AUDIT.subjectKind, subjectId: h.khalid.id, limit: 5 })).toHaveLength(1);
  });

  it('a newer photo since staff looked is not kept unseen', async () => {
    const h = await setup();
    const tikka = await h.dish(h.khalid.id, 'تكة');
    await h.catalog.replacePhoto(h.khalid.id, tikka.id, 'upload:up_old', undefined, null, true);
    const [seen] = await h.svc.queue(ZAINAB, { cityId: 'aziziyah' });
    h.clock.advance(5 * 60_000);
    await h.catalog.replacePhoto(h.khalid.id, tikka.id, 'upload:up_new', undefined, null, true);

    expect(await h.svc.keep(ZAINAB, { merchantOrgId: h.khalid.id, itemId: tikka.id, pendingSince: seen!.pendingSince })).toEqual({ itemId: tikka.id, outcome: 'changed' });
    expect((await h.svc.queue(ZAINAB, { cityId: 'aziziyah' })).map((r) => r.photoUrl)).toEqual(['/files/up_new?sig=x']);
  });

  it('a dish of another store is not found through the wrong store', async () => {
    const h = await setup();
    const masgouf = await h.dish(h.kut.id, 'مسكوف');
    await h.catalog.replacePhoto(h.kut.id, masgouf.id, 'upload:up_m', undefined, null, true);
    const [row] = await h.svc.queue(ZAINAB, { cityId: 'kut' });
    expect(await h.svc.keep(ZAINAB, { merchantOrgId: h.khalid.id, itemId: masgouf.id, pendingSince: row!.pendingSince })).toEqual({ itemId: masgouf.id, outcome: 'gone' });
  });
});
