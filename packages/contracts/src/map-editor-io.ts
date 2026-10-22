import { z } from 'zod';
import type { RoleKind } from './auth.js';
import { CityId, LatLng } from './common.js';
import type { Actor } from './identity-io.js';
import { LandmarkCategory } from './landmarks.js';
import { ZONE_EDIT_ROLES, ZONE_READ_ROLES } from './zones-io.js';

/**
 * Console › محرر الخريطة (Ali, 2026-10-20): one map where the team edits restaurants and landmarks
 * next to the areas, with every change kept in a history it can undo, and an inbox of fixes the
 * people on the road and the restaurants send in.
 */
export const MAP_READ_ROLES: readonly RoleKind[] = ZONE_READ_ROLES;
export const MAP_EDIT_ROLES: readonly RoleKind[] = ZONE_EDIT_ROLES;
/** Who may send a fix from an app: everyone who drives, the shops, and field ops on foot. */
export const MAP_REPORT_ROLES: readonly RoleKind[] = ['courier', 'driver', 'intercity_driver', 'khat_driver', 'merchant_staff', 'merchant_owner', 'field_ops'];

export const MAP_EDITOR_RULES = {
  nameMax: 60,
  aliasMax: 40,
  aliasesMax: 6,
  noteMax: 200,
  /** One drag of a multi-selection moves at most this many pins. */
  moveMax: 30,
  historyMax: 50,
  /** Reports about the same thing whose pins are this close are one card ("3 قالوا نفس الشي"). */
  sameReportM: 40,
  /** Two landmarks this close with a shared word in their names may be the same place. */
  duplicateM: 60,
  /** Open reports one person may have waiting. */
  openPerReporter: 20,
} as const;

export const MapEditorInput = z.object({ cityId: CityId.default('aziziyah') });
export type MapEditorInput = z.output<typeof MapEditorInput>;

export const MapRestaurant = z.object({
  orgId: z.string(),
  name: z.string(),
  type: z.enum(['restaurant', 'grocer']),
  /** The kitchen's pin couriers are sent to; null until the shop's place is on file. */
  pin: LatLng.nullable(),
  zoneKey: z.string().nullable(),
  zoneName: z.string().nullable(),
  pickupNote: z.string().nullable(),
});
export type MapRestaurant = z.infer<typeof MapRestaurant>;

export const MapLandmark = z.object({
  id: z.string(),
  name_ar: z.string(),
  aliases_ar: z.array(z.string()),
  category: LandmarkCategory,
  pin: LatLng,
  zoneKey: z.string().nullable(),
  /** A garage or a street-pickup point from the city setup: shown, but changed with the setup. */
  seeded: z.boolean(),
  /** Taken off every map (kept, so it can come back). */
  hidden: z.boolean(),
  photoUrl: z.string().nullable(),
});
export type MapLandmark = z.infer<typeof MapLandmark>;

export const MapLayers = z.object({ restaurants: z.array(MapRestaurant), landmarks: z.array(MapLandmark) });
export type MapLayers = z.infer<typeof MapLayers>;

const Name = z.string().trim().min(1).max(MAP_EDITOR_RULES.nameMax);
const Aliases = z.array(z.string().trim().min(1).max(MAP_EDITOR_RULES.aliasMax)).max(MAP_EDITOR_RULES.aliasesMax);

export const AddLandmarkInput = z.object({ cityId: CityId.default('aziziyah'), name_ar: Name, aliases_ar: Aliases.default([]), category: LandmarkCategory, pin: LatLng });
export type AddLandmarkInput = z.output<typeof AddLandmarkInput>;

/** Only the fields sent change. */
export const EditLandmarkInput = z.object({
  cityId: CityId.default('aziziyah'),
  id: z.string().min(1),
  name_ar: Name.optional(),
  aliases_ar: Aliases.optional(),
  category: LandmarkCategory.optional(),
  pin: LatLng.optional(),
  hidden: z.boolean().optional(),
});
export type EditLandmarkInput = z.output<typeof EditLandmarkInput>;

export const MapPinKind = z.enum(['landmark', 'restaurant']);
export type MapPinKind = z.infer<typeof MapPinKind>;

/** A drag of one pin, or of several picked together. */
export const MovePinsInput = z.object({
  cityId: CityId.default('aziziyah'),
  moves: z.array(z.object({ kind: MapPinKind, id: z.string().min(1), pin: LatLng })).min(1).max(MAP_EDITOR_RULES.moveMax),
});
export type MovePinsInput = z.output<typeof MovePinsInput>;

export const MergeLandmarksInput = z.object({ cityId: CityId.default('aziziyah'), keepId: z.string().min(1), dropId: z.string().min(1) });
export type MergeLandmarksInput = z.output<typeof MergeLandmarksInput>;

export const MapEditAction = z.enum(['add', 'edit', 'move', 'hide', 'show', 'merge']);
export type MapEditAction = z.infer<typeof MapEditAction>;

export const MapEditView = z.object({
  id: z.string(),
  kind: MapPinKind,
  targetId: z.string(),
  action: MapEditAction,
  summaryAr: z.string(),
  byName: z.string().nullable(),
  at: z.coerce.date(),
  undoneAt: z.coerce.date().nullable(),
  /** False when the same thing changed again since (undo the newer change first) or it was undone. */
  canUndo: z.boolean(),
});
export type MapEditView = z.infer<typeof MapEditView>;

export const MapHistoryInput = MapEditorInput.extend({ limit: z.number().int().min(1).max(MAP_EDITOR_RULES.historyMax).default(30) });
export const UndoMapEditInput = z.object({ cityId: CityId.default('aziziyah'), editId: z.string().min(1) });
export type UndoMapEditInput = z.output<typeof UndoMapEditInput>;

/** What a fix from an app says: a place moved, a new place, a wrong name, or a place that closed. */
export const MapReportKind = z.enum(['moved', 'new_place', 'wrong_name', 'closed']);
export type MapReportKind = z.infer<typeof MapReportKind>;

export const ReportMapFixInput = z
  .object({
    cityId: CityId.default('aziziyah'),
    kind: MapReportKind,
    target: z.object({ kind: MapPinKind, id: z.string().min(1) }).optional(),
    /** Where it really is (moved, new place). */
    pin: LatLng.optional(),
    /** The right name (new place, wrong name). */
    name_ar: Name.optional(),
    note: z.string().trim().max(MAP_EDITOR_RULES.noteMax).optional(),
  })
  .refine((r) => r.kind === 'new_place' || r.target !== undefined, { path: ['target'] })
  .refine((r) => (r.kind !== 'moved' && r.kind !== 'new_place') || r.pin !== undefined, { path: ['pin'] })
  .refine((r) => (r.kind !== 'new_place' && r.kind !== 'wrong_name') || r.name_ar !== undefined, { path: ['name_ar'] });
export type ReportMapFixInput = z.output<typeof ReportMapFixInput>;

export const MapReportSource = z.enum(['driver', 'merchant', 'ops']);
export type MapReportSource = z.infer<typeof MapReportSource>;

/** One card in the inbox: reports that say the same thing about the same place, together. */
export const MapReportCard = z.object({
  reportIds: z.array(z.string()).min(1),
  source: MapReportSource,
  kind: MapReportKind,
  target: z.object({ kind: MapPinKind, id: z.string(), name: z.string() }).nullable(),
  currentPin: LatLng.nullable(),
  proposedPin: LatLng.nullable(),
  proposedName: z.string().nullable(),
  /** How far the proposed pin is from the current one. */
  distanceM: z.number().int().nonnegative().nullable(),
  notes: z.array(z.string()),
  /** Different people who said it. */
  reporters: z.number().int().positive(),
  firstAt: z.coerce.date(),
  lastAt: z.coerce.date(),
});
export type MapReportCard = z.infer<typeof MapReportCard>;

export const MapDuplicate = z.object({ keep: MapLandmark, drop: MapLandmark, distanceM: z.number().int().nonnegative() });
export type MapDuplicate = z.infer<typeof MapDuplicate>;

export const MapInbox = z.object({
  counts: z.object({ driver: z.number().int().nonnegative(), merchant: z.number().int().nonnegative(), duplicate: z.number().int().nonnegative() }),
  cards: z.array(MapReportCard),
  duplicates: z.array(MapDuplicate),
});
export type MapInbox = z.infer<typeof MapInbox>;

export const DecideMapReportInput = z.object({
  cityId: CityId.default('aziziyah'),
  reportIds: z.array(z.string().min(1)).min(1).max(20),
  decision: z.enum(['accept', 'reject']),
  /** «عدّل قبل القبول»: the pin, name or icon as the team corrected them. */
  pin: LatLng.optional(),
  name_ar: Name.optional(),
  category: LandmarkCategory.optional(),
});
export type DecideMapReportInput = z.output<typeof DecideMapReportInput>;

export const MapReportAck = z.object({ reportId: z.string() });
export type MapReportAck = z.infer<typeof MapReportAck>;

/** What the API supplies to `ops.mapEditor.*` (`modules/map-editor`). */
export interface MapEditorPort {
  layers(actor: Actor, input: MapEditorInput): Promise<MapLayers>;
  addLandmark(actor: Actor, input: AddLandmarkInput): Promise<MapLandmark>;
  editLandmark(actor: Actor, input: EditLandmarkInput): Promise<MapLandmark>;
  movePins(actor: Actor, input: MovePinsInput): Promise<MapLayers>;
  merge(actor: Actor, input: MergeLandmarksInput): Promise<MapLandmark>;
  history(actor: Actor, input: z.output<typeof MapHistoryInput>): Promise<MapEditView[]>;
  undo(actor: Actor, input: UndoMapEditInput): Promise<MapEditView>;
  report(actor: Actor, input: ReportMapFixInput): Promise<MapReportAck>;
  inbox(actor: Actor, input: MapEditorInput): Promise<MapInbox>;
  decide(actor: Actor, input: DecideMapReportInput): Promise<MapInbox>;
}
