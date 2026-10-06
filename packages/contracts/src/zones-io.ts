import { z } from 'zod';
import { t, type Locale } from '@driver/i18n';
import type { RoleKind } from './auth.js';
import { ZoneTier } from './city-config.js';
import { CityId, LatLng, type Vertical } from './common.js';
import type { Actor } from './identity-io.js';
import { ZONE_MAX_POINTS, ZONE_MIN_POINTS, type ZoneShapeProblem } from './zone-geometry.js';

/** Who sees the zone map: Console readers plus field ops (they fix outlines on the ground). */
export const ZONE_READ_ROLES: readonly RoleKind[] = ['dispatcher', 'support', 'finance', 'admin', 'field_ops'];
/** Who draws outlines: Ali (admin) and field ops. Outlines don't move fees until the switch-over (SP3b). */
export const ZONE_EDIT_ROLES: readonly RoleKind[] = ['admin', 'field_ops'];

/** draft = the AI guess; placed = drawn on a real map in the Console; confirmed = drivers agreed on the ground. */
export const ZonePlacement = z.enum(['draft', 'placed', 'confirmed']);
export type ZonePlacement = z.infer<typeof ZonePlacement>;

/** Drivers' answers about a zone's current outline, for the Console zone tool. */
export const ZoneCheckTally = z.object({
  yes: z.number().int().nonnegative(),
  no: z.number().int().nonnegative(),
  /** Different drivers among the "yes" answers. */
  drivers: z.number().int().nonnegative(),
  /** The latest "لا" about this outline: the zone is flagged until the outline is fixed and saved. */
  flaggedAt: z.coerce.date().nullable(),
});
export type ZoneCheckTally = z.infer<typeof ZoneCheckTally>;

export const ZonePlacementView = z.object({
  key: z.string(),
  name_ar: z.string(),
  name_en: z.string(),
  tier: ZoneTier,
  group: z.string(),
  placement: ZonePlacement,
  /** Open ring (no closing point). */
  ring: z.array(LatLng),
  centre: LatLng,
  areaM2: z.number().nonnegative(),
  placedBy: z.string().nullable(),
  placedAt: z.coerce.date().nullable(),
  /** Drivers' answers about the current outline (absent where the server does not count them). */
  checks: ZoneCheckTally.optional(),
});
export type ZonePlacementView = z.infer<typeof ZonePlacementView>;

export const ZonesInput = z.object({ cityId: CityId.default('aziziyah') });

export const PlaceZoneInput = z.object({
  cityId: CityId.default('aziziyah'),
  key: z.string().trim().min(1).max(60),
  /** Open or closed ring (+1 allows the closing point). */
  ring: z.array(LatLng).min(ZONE_MIN_POINTS).max(ZONE_MAX_POINTS + 1),
  centre: LatLng,
});
export type PlaceZoneInput = z.input<typeof PlaceZoneInput>;

export const CreateZoneInput = z.object({
  cityId: CityId.default('aziziyah'),
  key: z.string().trim().min(2).max(60).regex(/^[a-z0-9_]+$/),
  name_ar: z.string().trim().min(1).max(100),
  name_en: z.string().trim().min(1).max(100),
  tier: ZoneTier,
  centre: LatLng,
});
export const RenameZoneInput = z.object({
  cityId: CityId.default('aziziyah'),
  key: z.string().trim().min(1).max(60),
  name_ar: z.string().trim().min(1).max(100),
  name_en: z.string().trim().min(1).max(100),
});
export const RemoveZoneInput = z.object({ cityId: CityId.default('aziziyah'), key: z.string().trim().min(1).max(60) });

// ───────────────────────── drivers confirm zones (SP3 §5.3) ─────────────────────────

/**
 * "انت بمنطقة X؟" at the end of a delivery (maps program SP3, decision D4: Ali places, drivers
 * confirm). The rules keep it rare and honest: one question a day, only where the arrival fix is
 * precise enough to tell which side of a border he stood on, and only while it is still fresh.
 */
export const ZONE_CHECK_RULES = {
  /** Questions per driver per Baghdad day: one tap after a delivery, never a survey. */
  perDriverPerDay: 1,
  /** "إي" answers about the same outline that make it `confirmed`… */
  yesToConfirm: 3,
  /** …coming from at least this many different drivers (one driver's habit is not the ground truth). */
  distinctDrivers: 2,
  /** An arrival fix worse than this (metres) can't say which zone he stood in: no question. */
  maxAccuracyM: 30,
  /** Unanswered after this many minutes, the question is dropped: he has driven on, the answer would be about somewhere else. */
  answerWithinMin: 30,
} as const;

/**
 * Trips whose last drop-off may carry the question: the job screen's done moment shows it. الرجعة
 * and خطوط runs have their own end screens (and children on board), so they are never asked.
 */
export const ZONE_CHECK_VERTICALS: readonly Vertical[] = ['food', 'grocery', 'errand', 'parcel', 'taxi', 'tuktuk'];

/** `unsure` is "ما أعرف": recorded so the question is not asked again, never counted either way. */
export const ZoneCheckAnswer = z.enum(['yes', 'no', 'unsure']);
export type ZoneCheckAnswer = z.infer<typeof ZoneCheckAnswer>;

/** The one open question for a driver. Names come from the server (zones added in the Console have no seed). */
export const ZoneCheckPrompt = z.object({
  checkId: z.string(),
  zoneKey: z.string(),
  name_ar: z.string(),
  name_en: z.string(),
  expiresAt: z.coerce.date(),
});
export type ZoneCheckPrompt = z.infer<typeof ZoneCheckPrompt>;

export const AnswerZoneCheckInput = z.object({ checkId: z.string().min(1).max(100), answer: ZoneCheckAnswer });
export type AnswerZoneCheckInput = z.infer<typeof AnswerZoneCheckInput>;

/** `ctx.zoneChecks`: the driver side of zone confirmation (`modules/zones`). */
export interface ZoneChecksPort {
  /** This driver's open question, or null (none asked, answered, expired, or the zone moved on). */
  open(actor: Actor): Promise<ZoneCheckPrompt | null>;
  answer(actor: Actor, input: AnswerZoneCheckInput): Promise<void>;
}

/** `ctx.zones`: zone outlines (`modules/zones`). */
export interface ZonesPort {
  list(cityId: string): Promise<ZonePlacementView[]>;
  place(actor: Actor, input: z.output<typeof PlaceZoneInput>): Promise<ZonePlacementView>;
  create?(actor: Actor, input: z.output<typeof CreateZoneInput>): Promise<ZonePlacementView>;
  rename?(actor: Actor, input: z.output<typeof RenameZoneInput>): Promise<ZonePlacementView>;
  remove?(actor: Actor, input: z.output<typeof RemoveZoneInput>): Promise<void>;
}

/** km² for people: two decimals under 1 km², one above. Western digits. */
export function formatAreaKm2(areaM2: number): string {
  const km2 = areaM2 / 1_000_000;
  return km2.toFixed(km2 < 1 ? 2 : 1);
}

/** The words for a shape problem; `nameOf` turns a zone key into its Arabic (or English) name. */
export function zoneProblemText(p: ZoneShapeProblem, nameOf: (key: string) => string, locale: Locale = 'ar-IQ'): string {
  switch (p.kind) {
    case 'too_small':
    case 'too_large':
      return t(`zone_shape.${p.kind}`, { area: formatAreaKm2(p.areaM2) }, locale);
    case 'overlap':
      return t('zone_shape.overlap', { name: nameOf(p.withKey), area: formatAreaKm2(p.areaM2) }, locale);
    default:
      return t(`zone_shape.${p.kind}`, undefined, locale);
  }
}
