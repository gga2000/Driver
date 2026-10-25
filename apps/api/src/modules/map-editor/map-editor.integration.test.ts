import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { PrismaPlacesRepository } from '../places/index.js';
import { PrismaMapEditorRepository } from './map-editor.repository.js';

const url = process.env['DATABASE_URL'];
const CITY = 'zt_map_editor_city';

describe.skipIf(!url)('map editor on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const repo = new PrismaMapEditorRepository(prisma);
  const places = new PrismaPlacesRepository(prisma);
  const AT = new Date('2026-10-20T21:00:00Z');
  const pin = { lat: 32.9045, lng: 45.0595 };

  beforeAll(async () => {
    await prisma.prisma.$executeRaw`INSERT INTO "public"."cities" ("id", "name_ar", "name_en", "updated_at") VALUES (${CITY}, 'تجربة', 'Test', now()) ON CONFLICT ("id") DO NOTHING`;
  });

  afterAll(async () => {
    await prisma.prisma.$executeRaw`DELETE FROM "public"."map_edits" WHERE "city_id" = ${CITY}`;
    await prisma.prisma.$executeRaw`DELETE FROM "public"."map_reports" WHERE "city_id" = ${CITY}`;
    await prisma.prisma.$executeRaw`DELETE FROM "public"."places" WHERE "city_id" = ${CITY}`;
    await prisma.prisma.$executeRaw`DELETE FROM "public"."cities" WHERE "id" = ${CITY}`;
    await prisma.onModuleDestroy();
  });

  it('a landmark row takes other names, a new pin and the hidden state, and the editor lists it', async () => {
    const lm = await places.save({ cityId: CITY, pin, name: 'جامع الرحمن', photos: [], confidence: 1, sharedWith: [], landmark: true, landmarkCategory: 'mosque', landmarkState: 'approved', localNames: ['الرحمن'] });
    expect(lm.localNames).toEqual(['الرحمن']);
    const moved = await places.editLandmark(lm.id, { name: 'جامع الرحمة', localNames: [], pin: { lat: 32.905, lng: 45.06 }, state: 'hidden' });
    expect(moved).toMatchObject({ name: 'جامع الرحمة', landmarkState: 'hidden', pin: { lat: 32.905, lng: 45.06 } });
    expect(moved?.localNames).toBeUndefined();
    expect((await places.landmarks(CITY)).map((p) => p.id)).toEqual([]);
    expect((await places.editableLandmarks(CITY)).map((p) => p.id)).toEqual([lm.id]);
    expect(await places.editLandmark('pl_nope', { name: 'x' })).toBeNull();
  });

  it('keeps edits newest first with what they were before, and marks one undone once', async () => {
    const first = await repo.addEdit({ cityId: CITY, targetKind: 'landmark', targetId: 'pl_x', action: 'add', summaryAr: 'ضاف', before: { state: 'hidden' }, after: { name: 'x', pin }, mergedId: null, actorId: 'p_ali', createdAt: AT });
    const second = await repo.addEdit({ cityId: CITY, targetKind: 'landmark', targetId: 'pl_x', action: 'move', summaryAr: 'حرّك', before: { pin }, after: { pin: { lat: 32.91, lng: 45.06 } }, mergedId: null, actorId: 'p_ali', createdAt: new Date(AT.getTime() + 1000) });
    expect((await repo.edits(CITY, 10)).map((e) => e.id)).toEqual([second.id, first.id]);
    expect((await repo.latestFor('landmark', 'pl_x'))?.id).toBe(second.id);
    await repo.markUndone(second.id, 'p_ali', AT);
    await repo.markUndone(second.id, 'p_sami', new Date(AT.getTime() + 5000));
    expect(await repo.edit(second.id)).toMatchObject({ undoneById: 'p_ali', before: { pin } });
    expect((await repo.latestFor('landmark', 'pl_x'))?.id).toBe(first.id);
  });

  it('keeps reports open until decided, counted per reporter', async () => {
    const r = await repo.addReport({ cityId: CITY, source: 'driver', kind: 'moved', targetKind: 'restaurant', targetId: 'org_1', pin, nameAr: null, note: 'بعد الإشارة', reporterId: 'p_yasir', createdAt: AT });
    expect(r).toMatchObject({ state: 'open', pin });
    expect(await repo.openCountBy('p_yasir')).toBe(1);
    expect((await repo.openReports(CITY)).map((x) => x.id)).toEqual([r.id]);
    await repo.decide([r.id], 'accepted', 'p_ali', AT);
    await repo.decide([r.id], 'rejected', 'p_sami', AT);
    expect((await repo.reports([r.id]))[0]).toMatchObject({ state: 'accepted', decidedById: 'p_ali' });
    expect(await repo.openReports(CITY)).toEqual([]);
  });
});
