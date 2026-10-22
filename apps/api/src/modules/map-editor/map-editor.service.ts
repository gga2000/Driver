import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  AZIZIYAH_LANDMARKS,
  DriverError,
  foldArabic,
  landmarkCategoryOf,
  MAP_EDITOR_RULES,
  westernDigits,
  type Actor,
  type AddLandmarkInput,
  type DecideMapReportInput,
  type EditLandmarkInput,
  type LatLng,
  type MapDuplicate,
  type MapEditAction,
  type MapEditorInput,
  type MapEditorPort,
  type MapEditView,
  type MapInbox,
  type MapLandmark,
  type MapLayers,
  type MapPinKind,
  type MapReportAck,
  type MapReportCard,
  type MapReportSource,
  type MapRestaurant,
  type MergeLandmarksInput,
  type MovePinsInput,
  type Place,
  type ReportMapFixInput,
  type RoleKind,
  type UndoMapEditInput,
} from '@driver/contracts';
import { CLOCK, SystemClock, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { AuditLogService, StaffNames } from '../controls/index.js';
import { IdentityService } from '../identity/index.js';
import { OpsPickupSpotsService } from '../ops/index.js';
import { OrgsService } from '../orgs/index.js';
import { distanceM, LandmarkFeedService, PlacesService, ZoneResolver, type LandmarkPatch } from '../places/index.js';
import { InMemoryMapEditorRepository, MAP_EDITOR_REPOSITORY, type MapEditFields, type MapEditorRepository, type MapEditRecord, type MapReportRecord } from './map-editor.repository.js';

/** Seeded landmarks are not rows: their ids are the seed key with this prefix (as everywhere else). */
const SEED_PREFIX = 'lm_';
/** The audit subject for every map-editor row (the Console audit page shows them with the rest). */
const SUBJECT = 'map_place';
/** Words too common to make two landmark names "the same" on their own. */
const COMMON_WORDS = new Set(['باب', 'شارع', 'جامع', 'مدرسه', 'سوق', 'فرن', 'مطعم', 'جسر', 'تقاطع', 'كراج', 'حي'].map(foldArabic));

const samePin = (a: LatLng | null | undefined, b: LatLng | null | undefined) => (a ?? null) === (b ?? null) || (a != null && b != null && Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7);
const sameList = (a: readonly string[] = [], b: readonly string[] = []) => a.length === b.length && a.every((x, i) => x === b[i]);
const cleanAliases = (list: readonly string[], name: string) => [...new Set(list.map((a) => westernDigits(a.trim())).filter((a) => a && a !== name))].slice(0, MAP_EDITOR_RULES.aliasesMax);

/**
 * Console › محرر الخريطة (Ali, 2026-10-20): the restaurants' kitchen pins and the city's landmarks on
 * one map, edited in place. A landmark change lands on the `places` row (every app's landmark layer
 * and «وين رايح؟» read it, the feed is rebuilt at once); a restaurant move goes through the stores'
 * own «حرّك مكان المطعم» (its zone read from the pin, its own audit row). Every change is kept in
 * `map_edits` with what it was before, so the team can undo it while nothing changed it since.
 * Fixes sent from the apps wait in `map_reports` until the team accepts (the change is made) or
 * rejects them. Garages and street-pickup points come from the city setup and stay as they are here.
 */
@Injectable()
export class MapEditorService implements MapEditorPort {
  private readonly clock: Clock;
  private readonly repo: MapEditorRepository;
  private readonly zones = new ZoneResolver();

  constructor(
    private readonly places: PlacesService,
    private readonly feed: LandmarkFeedService,
    private readonly orgs: OrgsService,
    private readonly pickupSpots: OpsPickupSpotsService,
    private readonly audits: AuditLogService,
    private readonly names: StaffNames,
    private readonly identity: IdentityService,
    private readonly uow: UnitOfWork,
    @Optional() @Inject(MAP_EDITOR_REPOSITORY) repo?: MapEditorRepository,
    @Optional() @Inject(CLOCK) clock?: Clock,
  ) {
    this.repo = repo ?? new InMemoryMapEditorRepository();
    this.clock = clock ?? new SystemClock();
  }

  // ───────────────────────── layers ─────────────────────────

  async layers(_actor: Actor, input: MapEditorInput): Promise<MapLayers> {
    const [restaurants, landmarks] = await Promise.all([this.restaurants(input.cityId), this.landmarks(input.cityId)]);
    return { restaurants, landmarks };
  }

  private async restaurants(cityId: string): Promise<MapRestaurant[]> {
    const orgs = (await this.orgs.inCity(cityId)).filter((o) => o.type === 'restaurant' || o.type === 'grocer');
    return orgs
      .map((o): MapRestaurant => {
        const at = o.merchant?.location ?? null;
        return {
          orgId: o.id,
          name: o.name,
          type: o.type as MapRestaurant['type'],
          pin: at?.pin ?? null,
          zoneKey: at?.zoneKey ?? null,
          zoneName: at ? this.zones.names(cityId, at.zoneKey).ar : null,
          pickupNote: o.merchant?.pickupSpot?.note ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ar') || a.orgId.localeCompare(b.orgId));
  }

  private async landmarks(cityId: string): Promise<MapLandmark[]> {
    const seeded: MapLandmark[] =
      cityId === 'aziziyah'
        ? AZIZIYAH_LANDMARKS.map((l) => ({
            id: `${SEED_PREFIX}${l.key}`,
            name_ar: westernDigits(l.name_ar),
            aliases_ar: [...(l.aliases_ar ?? [])],
            category: landmarkCategoryOf(l.name_ar, l.kind),
            pin: { lat: l.lat, lng: l.lng },
            zoneKey: this.zones.resolve(cityId, { lat: l.lat, lng: l.lng }) ?? l.zoneId,
            seeded: true,
            hidden: false,
            photoUrl: null,
          }))
        : [];
    const rows = (await this.places.editableLandmarks(cityId)).map((p) => this.landmarkOf(p));
    return [...seeded, ...rows];
  }

  private landmarkOf(p: Place): MapLandmark {
    return {
      id: p.id,
      name_ar: westernDigits(p.name),
      aliases_ar: [...(p.localNames ?? [])],
      category: p.landmarkCategory ?? landmarkCategoryOf(p.name),
      pin: p.pin,
      zoneKey: this.zones.resolve(p.cityId, p.pin),
      seeded: false,
      hidden: p.landmarkState === 'hidden',
      photoUrl: p.photos[0]?.url ?? null,
    };
  }

  /** A landmark row the editor may change; a seed id is refused by name, anything else is unknown. */
  private async row(cityId: string, id: string): Promise<Place> {
    if (id.startsWith(SEED_PREFIX)) throw new DriverError('map_landmark_seeded');
    const p = await this.places.get(id);
    if (!p || p.cityId !== cityId || !p.landmark || !['approved', 'hidden', undefined].includes(p.landmarkState)) throw new DriverError('map_place_unknown');
    return p;
  }

  private inService(cityId: string, pin: LatLng): void {
    if (!this.zones.resolve(cityId, pin)) throw new DriverError('outside_zone');
  }

  // ───────────────────────── landmarks ─────────────────────────

  async addLandmark(actor: Actor, input: AddLandmarkInput): Promise<MapLandmark> {
    this.inService(input.cityId, input.pin);
    const name = westernDigits(input.name_ar.trim());
    const localNames = cleanAliases(input.aliases_ar, name);
    const saved = await this.places.save({
      cityId: input.cityId,
      pin: input.pin,
      name,
      photos: [],
      confidence: 1,
      sharedWith: [],
      landmark: true,
      landmarkCategory: input.category,
      landmarkState: 'approved',
      localNames,
    });
    await this.uow.run((tx) =>
      this.record(actor, { cityId: input.cityId, kind: 'landmark', id: saved.id, action: 'add', summaryAr: `ضاف «${name}» على الخريطة`, before: { state: 'hidden' }, after: { name, localNames, category: input.category, pin: input.pin, state: 'approved' } }, tx),
    );
    this.feed.invalidate(input.cityId);
    return this.landmarkOf(saved);
  }

  async editLandmark(actor: Actor, input: EditLandmarkInput): Promise<MapLandmark> {
    const p = await this.row(input.cityId, input.id);
    if (input.pin) this.inService(input.cityId, input.pin);
    const name = input.name_ar !== undefined ? westernDigits(input.name_ar.trim()) : undefined;
    const patch: LandmarkPatch = {};
    const before: MapEditFields = {};
    if (name !== undefined && name !== p.name) [patch.name, before.name] = [name, p.name];
    if (input.aliases_ar !== undefined) {
      const next = cleanAliases(input.aliases_ar, name ?? p.name);
      if (!sameList(next, p.localNames)) [patch.localNames, before.localNames] = [next, [...(p.localNames ?? [])]];
    }
    if (input.category !== undefined && input.category !== p.landmarkCategory) [patch.category, before.category] = [input.category, p.landmarkCategory ?? null];
    if (input.pin !== undefined && !samePin(input.pin, p.pin)) [patch.pin, before.pin] = [input.pin, p.pin];
    const hidden = p.landmarkState === 'hidden';
    if (input.hidden !== undefined && input.hidden !== hidden) [patch.state, before.state] = [input.hidden ? 'hidden' : 'approved', hidden ? 'hidden' : 'approved'];
    if (Object.keys(patch).length === 0) return this.landmarkOf(p);
    const action: MapEditAction = patch.state ? (patch.state === 'hidden' ? 'hide' : 'show') : Object.keys(patch).length === 1 && patch.pin ? 'move' : 'edit';
    const label = name ?? p.name;
    const summaryAr = {
      hide: `شال «${label}» من الخريطة`,
      show: `رجّع «${label}» للخريطة`,
      move: `حرّك «${label}»`,
      edit: patch.name ? `غيّر اسم «${p.name}» إلى «${label}»` : `عدّل «${label}»`,
      add: '',
      merge: '',
    }[action];
    const saved = await this.uow.run(async (tx) => {
      const row = await this.places.editLandmark(p.id, patch, tx);
      if (!row) throw new DriverError('map_place_unknown');
      await this.record(actor, { cityId: input.cityId, kind: 'landmark', id: p.id, action, summaryAr, before, after: { ...patch } }, tx);
      return row;
    });
    this.feed.invalidate(input.cityId);
    return this.landmarkOf(saved);
  }

  async movePins(actor: Actor, input: MovePinsInput): Promise<MapLayers> {
    for (const m of input.moves) this.inService(input.cityId, m.pin);
    for (const m of input.moves) {
      if (m.kind === 'landmark') await this.editLandmark(actor, { cityId: input.cityId, id: m.id, pin: m.pin });
      else await this.moveRestaurant(actor, input.cityId, m.id, m.pin);
    }
    return this.layers(actor, { cityId: input.cityId });
  }

  private async moveRestaurant(actor: Actor, cityId: string, orgId: string, pin: LatLng): Promise<void> {
    const org = await this.orgs.get(orgId).catch(() => null);
    if (!org || org.cityId !== cityId || (org.type !== 'restaurant' && org.type !== 'grocer')) throw new DriverError('map_place_unknown');
    const from = org.merchant?.location?.pin ?? null;
    if (samePin(from, pin)) return;
    // The stores' own move: zone from the pin, its own audit row («حرّك مكان المطعم»).
    await this.pickupSpots.moveKitchen(actor, { merchantOrgId: orgId, pin });
    await this.uow.run((tx) => this.record(actor, { cityId, kind: 'restaurant', id: orgId, action: 'move', summaryAr: `حرّك «${org.name}»`, before: { pin: from }, after: { pin } }, tx));
  }

  async merge(actor: Actor, input: MergeLandmarksInput): Promise<MapLandmark> {
    if (input.keepId === input.dropId) throw new DriverError('invalid_input');
    if (input.keepId.startsWith(SEED_PREFIX)) {
      // A garage or pickup point from the setup keeps its names: the copy is only taken off the maps.
      const seed = (await this.landmarks(input.cityId)).find((l) => l.id === input.keepId);
      if (!seed) throw new DriverError('map_place_unknown');
      await this.editLandmark(actor, { cityId: input.cityId, id: input.dropId, hidden: true });
      return seed;
    }
    const [keep, drop] = [await this.row(input.cityId, input.keepId), await this.row(input.cityId, input.dropId)];
    if (keep.landmarkState === 'hidden' || drop.landmarkState === 'hidden') throw new DriverError('map_edit_stale');
    const localNames = cleanAliases([...(keep.localNames ?? []), drop.name, ...(drop.localNames ?? [])], keep.name);
    const saved = await this.uow.run(async (tx) => {
      const row = await this.places.editLandmark(keep.id, { localNames }, tx);
      await this.places.editLandmark(drop.id, { state: 'hidden' }, tx);
      if (!row) throw new DriverError('map_place_unknown');
      await this.record(
        actor,
        { cityId: input.cityId, kind: 'landmark', id: keep.id, action: 'merge', mergedId: drop.id, summaryAr: `دمج «${drop.name}» ويا «${keep.name}»`, before: { localNames: [...(keep.localNames ?? [])] }, after: { localNames } },
        tx,
      );
      return row;
    });
    this.feed.invalidate(input.cityId);
    return this.landmarkOf(saved);
  }

  private async record(
    actor: Actor,
    e: { cityId: string; kind: MapPinKind; id: string; action: MapEditAction; summaryAr: string; before: MapEditFields; after: MapEditFields; mergedId?: string },
    tx: Tx,
  ): Promise<MapEditRecord> {
    const row = await this.repo.addEdit(
      { cityId: e.cityId, targetKind: e.kind, targetId: e.id, action: e.action, summaryAr: e.summaryAr, before: e.before, after: e.after, mergedId: e.mergedId ?? null, actorId: actor.personId, createdAt: this.clock.now() },
      tx,
    );
    // A restaurant move already wrote the stores' own audit row; a landmark change writes one here.
    if (e.kind === 'landmark') {
      await this.audits.record({ cityId: e.cityId, actorId: actor.personId, action: `map.landmark_${e.action}`, subjectKind: SUBJECT, subjectId: e.id, summaryAr: e.summaryAr, detail: { editId: row.id, before: e.before, after: e.after } }, tx);
    }
    return row;
  }

  // ───────────────────────── history and undo ─────────────────────────

  async history(_actor: Actor, input: { cityId: string; limit: number }): Promise<MapEditView[]> {
    const rows = await this.repo.edits(input.cityId, input.limit);
    const names = await this.names.of(rows.map((r) => r.actorId));
    // Newest first: the first row of a target that is not undone is its latest, the only one to undo.
    const seen = new Set<string>();
    return rows.map((r) => {
      const key = `${r.targetKind}:${r.targetId}`;
      const latest = r.undoneAt === null && !seen.has(key);
      if (r.undoneAt === null) seen.add(key);
      if (r.mergedId && r.undoneAt === null) seen.add(`landmark:${r.mergedId}`);
      const undoable = latest && !(r.targetKind === 'restaurant' && !r.before.pin);
      return this.editView(r, names[r.actorId] ?? null, undoable);
    });
  }

  private editView(r: MapEditRecord, byName: string | null, canUndo: boolean): MapEditView {
    return { id: r.id, kind: r.targetKind, targetId: r.targetId, action: r.action, summaryAr: r.summaryAr, byName, at: r.createdAt, undoneAt: r.undoneAt, canUndo };
  }

  async undo(actor: Actor, input: UndoMapEditInput): Promise<MapEditView> {
    const e = await this.repo.edit(input.editId);
    if (!e || e.cityId !== input.cityId) throw new DriverError('map_place_unknown');
    const latest = await this.repo.latestFor(e.targetKind, e.targetId);
    if (e.undoneAt !== null || latest?.id !== e.id) throw new DriverError('map_edit_stale');
    const at = this.clock.now();
    if (e.targetKind === 'restaurant') {
      const org = await this.orgs.get(e.targetId);
      // Undone only while the kitchen is still where this edit put it (the owner may have moved it since).
      if (!e.before.pin || !samePin(org.merchant?.location?.pin ?? null, e.after.pin ?? null)) throw new DriverError('map_edit_stale');
      await this.pickupSpots.moveKitchen(actor, { merchantOrgId: e.targetId, pin: e.before.pin });
      await this.repo.markUndone(e.id, actor.personId, at);
    } else {
      const p = await this.places.get(e.targetId);
      if (!p || !this.matches(p, e.after)) throw new DriverError('map_edit_stale');
      if (e.mergedId) {
        const dropped = await this.places.get(e.mergedId);
        if (dropped?.landmarkState !== 'hidden') throw new DriverError('map_edit_stale');
      }
      await this.uow.run(async (tx) => {
        await this.places.editLandmark(e.targetId, this.patchOf(e.before), tx);
        if (e.mergedId) await this.places.editLandmark(e.mergedId, { state: 'approved' }, tx);
        await this.repo.markUndone(e.id, actor.personId, at, tx);
        await this.audits.record({ cityId: e.cityId, actorId: actor.personId, action: 'map.edit_undone', subjectKind: SUBJECT, subjectId: e.targetId, summaryAr: `رجّع: ${e.summaryAr}`, detail: { editId: e.id } }, tx);
      });
      this.feed.invalidate(e.cityId);
    }
    const names = await this.names.of([e.actorId]);
    return this.editView({ ...e, undoneAt: at, undoneById: actor.personId }, names[e.actorId] ?? null, false);
  }

  /** The row still shows what the edit made it (nothing changed it since, here or elsewhere). */
  private matches(p: Place, after: MapEditFields): boolean {
    if (after.name !== undefined && after.name !== p.name) return false;
    if (after.localNames !== undefined && !sameList(after.localNames, p.localNames)) return false;
    if (after.category !== undefined && (after.category ?? undefined) !== p.landmarkCategory) return false;
    if (after.pin !== undefined && !samePin(after.pin, p.pin)) return false;
    if (after.state !== undefined && after.state !== (p.landmarkState ?? 'approved')) return false;
    return true;
  }

  private patchOf(f: MapEditFields): LandmarkPatch {
    const patch: LandmarkPatch = {};
    if (f.name !== undefined) patch.name = f.name;
    if (f.localNames !== undefined) patch.localNames = f.localNames;
    if (f.category !== undefined) patch.category = f.category ?? undefined;
    if (f.pin) patch.pin = f.pin;
    if (f.state !== undefined) patch.state = f.state;
    return patch;
  }

  // ───────────────────────── fixes from the apps ─────────────────────────

  async report(actor: Actor, input: ReportMapFixInput): Promise<MapReportAck> {
    if ((await this.repo.openCountBy(actor.personId)) >= MAP_EDITOR_RULES.openPerReporter) throw new DriverError('map_reports_limit');
    if (input.pin) this.inService(input.cityId, input.pin);
    if (input.target) {
      const layers = await this.layers(actor, { cityId: input.cityId });
      const known = input.target.kind === 'landmark' ? layers.landmarks.some((l) => l.id === input.target?.id && !l.hidden) : layers.restaurants.some((r) => r.orgId === input.target?.id);
      if (!known) throw new DriverError('map_place_unknown');
    }
    const roles = await this.identity.activeRoles(actor.personId);
    const row = await this.repo.addReport({
      cityId: input.cityId,
      source: sourceOf(roles),
      kind: input.kind,
      targetKind: input.target?.kind ?? null,
      targetId: input.target?.id ?? null,
      pin: input.pin ?? null,
      nameAr: input.name_ar ? westernDigits(input.name_ar.trim()) : null,
      note: input.note?.trim() || null,
      reporterId: actor.personId,
      createdAt: this.clock.now(),
    });
    return { reportId: row.id };
  }

  async inbox(actor: Actor, input: MapEditorInput): Promise<MapInbox> {
    const [open, layers] = await Promise.all([this.repo.openReports(input.cityId), this.layers(actor, input)]);
    const cards = groupReports(open, layers);
    const duplicates = findDuplicates(layers.landmarks);
    return {
      counts: { driver: cards.filter((c) => c.source !== 'merchant').length, merchant: cards.filter((c) => c.source === 'merchant').length, duplicate: duplicates.length },
      cards,
      duplicates,
    };
  }

  async decide(actor: Actor, input: DecideMapReportInput): Promise<MapInbox> {
    const rows = await this.repo.reports(input.reportIds);
    if (rows.length !== input.reportIds.length || rows.some((r) => r.cityId !== input.cityId || r.state !== 'open')) throw new DriverError('map_report_unknown');
    const lead = rows[0]!;
    if (rows.some((r) => r.kind !== lead.kind || r.targetKind !== lead.targetKind || r.targetId !== lead.targetId)) throw new DriverError('invalid_input');
    if (input.decision === 'accept') await this.apply(actor, input, rows);
    await this.uow.run(async (tx) => {
      await this.repo.decide(input.reportIds, input.decision === 'accept' ? 'accepted' : 'rejected', actor.personId, this.clock.now(), tx);
      await this.audits.record(
        {
          cityId: input.cityId,
          actorId: actor.personId,
          action: input.decision === 'accept' ? 'map.report_accepted' : 'map.report_rejected',
          subjectKind: SUBJECT,
          subjectId: lead.targetId ?? lead.id,
          summaryAr: input.decision === 'accept' ? 'قبل تصليح من الطريق' : 'رفض تصليح من الطريق',
          detail: { reports: input.reportIds.length, kind: lead.kind },
        },
        tx,
      );
    });
    return this.inbox(actor, { cityId: input.cityId });
  }

  /** Accepting makes the change the report asked for (as the team corrected it). */
  private async apply(actor: Actor, input: DecideMapReportInput, rows: readonly MapReportRecord[]): Promise<void> {
    const lead = rows[0]!;
    const pin = input.pin ?? meanPin(rows.map((r) => r.pin));
    const name = input.name_ar ?? mostCommon(rows.map((r) => r.nameAr));
    if (lead.kind === 'new_place') {
      if (!pin || !name) throw new DriverError('invalid_input');
      await this.addLandmark(actor, { cityId: input.cityId, name_ar: name, aliases_ar: [], category: input.category ?? landmarkCategoryOf(name), pin });
      return;
    }
    if (!lead.targetKind || !lead.targetId) throw new DriverError('invalid_input');
    if (lead.kind === 'moved') {
      if (!pin) throw new DriverError('invalid_input');
      await this.movePins(actor, { cityId: input.cityId, moves: [{ kind: lead.targetKind, id: lead.targetId, pin }] });
      return;
    }
    // A restaurant's name or a closed shop is the stores page's call: accepting files the report.
    if (lead.targetKind === 'restaurant') return;
    if (lead.kind === 'wrong_name') {
      if (!name) throw new DriverError('invalid_input');
      await this.editLandmark(actor, { cityId: input.cityId, id: lead.targetId, name_ar: name, ...(input.category ? { category: input.category } : {}) });
    } else {
      await this.editLandmark(actor, { cityId: input.cityId, id: lead.targetId, hidden: true });
    }
  }
}

/** Which inbox tab a person's fixes land in: the shops', or the road's (drivers and field ops). */
export function sourceOf(roles: readonly RoleKind[]): MapReportSource {
  if (roles.includes('merchant_owner') || roles.includes('merchant_staff')) return 'merchant';
  if (roles.includes('field_ops')) return 'ops';
  return 'driver';
}

function meanPin(pins: ReadonlyArray<LatLng | null>): LatLng | null {
  const list = pins.filter((p): p is LatLng => p !== null);
  if (list.length === 0) return null;
  return { lat: list.reduce((s, p) => s + p.lat, 0) / list.length, lng: list.reduce((s, p) => s + p.lng, 0) / list.length };
}

function mostCommon(values: ReadonlyArray<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = v;
  return best;
}

/**
 * One card per thing said: reports of the same kind about the same place (or, for a new place, the
 * same name) whose pins are within `sameReportM` of the card's first pin. Most-agreed first.
 */
export function groupReports(open: readonly MapReportRecord[], layers: MapLayers): MapReportCard[] {
  const groups: MapReportRecord[][] = [];
  for (const r of open) {
    const g = groups.find((list) => {
      const head = list[0]!;
      if (head.kind !== r.kind || head.targetKind !== r.targetKind || head.targetId !== r.targetId) return false;
      if (r.kind === 'new_place' && foldArabic(head.nameAr ?? '') !== foldArabic(r.nameAr ?? '') && !(head.pin && r.pin && distanceM(head.pin, r.pin) <= MAP_EDITOR_RULES.sameReportM)) return false;
      return !head.pin || !r.pin || distanceM(head.pin, r.pin) <= MAP_EDITOR_RULES.sameReportM;
    });
    if (g) g.push(r);
    else groups.push([r]);
  }
  const cards = groups.map((list): MapReportCard => {
    const head = list[0]!;
    const target =
      head.targetKind === 'landmark'
        ? layers.landmarks.find((l) => l.id === head.targetId)
        : head.targetKind === 'restaurant'
          ? layers.restaurants.find((s) => s.orgId === head.targetId)
          : undefined;
    const currentPin = target ? target.pin : null;
    const proposedPin = meanPin(list.map((r) => r.pin));
    const sources = list.map((r) => r.source);
    const source: MapReportSource = sources.includes('merchant') ? 'merchant' : sources.includes('driver') ? 'driver' : 'ops';
    return {
      reportIds: list.map((r) => r.id),
      source,
      kind: head.kind,
      target: head.targetKind && head.targetId ? { kind: head.targetKind, id: head.targetId, name: target ? ('orgId' in target ? target.name : target.name_ar) : head.targetId } : null,
      currentPin,
      proposedPin,
      proposedName: mostCommon(list.map((r) => r.nameAr)),
      distanceM: currentPin && proposedPin ? Math.round(distanceM(currentPin, proposedPin)) : null,
      notes: [...new Set(list.map((r) => r.note).filter((n): n is string => Boolean(n)))].slice(0, 5),
      reporters: new Set(list.map((r) => r.reporterId)).size,
      firstAt: list[0]!.createdAt,
      lastAt: list[list.length - 1]!.createdAt,
    };
  });
  return cards.sort((a, b) => b.reporters - a.reporters || b.lastAt.getTime() - a.lastAt.getTime() || a.reportIds[0]!.localeCompare(b.reportIds[0]!));
}

const words = (name: string) => new Set(foldArabic(name).split(/\s+/).map((w) => w.replace(/^ال/, '')).filter((w) => w.length >= 3 && !COMMON_WORDS.has(w)));

/**
 * Landmarks that may be one place: shown ones within `duplicateM` sharing a name word that is not a
 * common one («جامع», «باب»…). The one kept is the setup's, else the one with a photo, else more names.
 */
export function findDuplicates(all: readonly MapLandmark[]): MapDuplicate[] {
  const shown = all.filter((l) => !l.hidden);
  const out: MapDuplicate[] = [];
  const rank = (l: MapLandmark) => (l.seeded ? 4 : 0) + (l.photoUrl ? 2 : 0) + Math.min(1, l.aliases_ar.length);
  for (let i = 0; i < shown.length; i += 1) {
    for (let j = i + 1; j < shown.length; j += 1) {
      const a = shown[i]!;
      const b = shown[j]!;
      if (a.seeded && b.seeded) continue;
      const d = distanceM(a.pin, b.pin);
      if (d > MAP_EDITOR_RULES.duplicateM) continue;
      const wa = words([a.name_ar, ...a.aliases_ar].join(' '));
      if (![...words([b.name_ar, ...b.aliases_ar].join(' '))].some((w) => wa.has(w))) continue;
      const [keep, drop] = rank(a) >= rank(b) ? [a, b] : [b, a];
      if (drop.seeded) continue;
      out.push({ keep, drop, distanceM: Math.round(d) });
    }
  }
  return out.sort((x, y) => x.distanceM - y.distanceM || x.drop.id.localeCompare(y.drop.id));
}

