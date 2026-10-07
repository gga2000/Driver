import { z } from 'zod';
import { CityId, LatLng } from './common.js';
import { foldArabic } from './search.js';

/**
 * Landmarks on the map (maps program b3): what kind of place a landmark is, so every map draws the
 * same icon for it. `other` is a park, a roundabout, a junction — anything people meet at that is
 * none of the rest.
 */
export const LANDMARK_CATEGORIES = ['mosque', 'school', 'market', 'clinic', 'fuel', 'bridge', 'garage', 'other'] as const;
export const LandmarkCategory = z.enum(LANDMARK_CATEGORIES);
export type LandmarkCategory = z.infer<typeof LandmarkCategory>;

/**
 * Words (folded with `foldArabic`, so «الجامع» = «جامع», «مدرسة» = «مدرسه») that name a category, in
 * the order they are tried: «كراج السوق» is a garage before it is a market, «محطة وقود» needs the fuel
 * word (a bare «محطة» is a bus stop). A whole word must match: «جامعة» (a university) is a school,
 * «جامع» a mosque.
 */
const CATEGORY_WORDS: ReadonlyArray<readonly [LandmarkCategory, readonly string[]]> = [
  ['fuel', ['وقود', 'بانزين', 'بنزين', 'بانزينخانه', 'بنزينخانه', 'كازخانه']],
  ['garage', ['كراج', 'گراج', 'مراب']],
  ['bridge', ['جسر', 'قنطره']],
  ['clinic', ['مستشفي', 'مستوصف', 'عياده', 'صيدليه', 'صحي', 'طوارئ', 'طوارى']],
  ['school', ['مدرسه', 'كليه', 'جامعه', 'معهد', 'روضه', 'ثانويه', 'اعداديه', 'متوسطه', 'ابتداييه']],
  ['mosque', ['جامع', 'مسجد', 'حسينيه', 'مرقد']],
  ['market', ['سوق', 'سوك', 'مول', 'قيصريه', 'علوه']],
];

/**
 * The category of a landmark that has none on file: the seeded garages and meeting points, and older
 * landmark rows. A seed of kind `garage` is a garage whatever its name; otherwise the first category
 * a word of the name belongs to, else `other`. Pure, so the server and a test agree on every seed.
 */
export function landmarkCategoryOf(name: string, kind?: 'garage' | 'meeting_point' | 'landmark'): LandmarkCategory {
  if (kind === 'garage') return 'garage';
  const words = new Set(foldArabic(name).split(' '));
  for (const [category, list] of CATEGORY_WORDS) if (list.some((w) => words.has(foldArabic(w)))) return category;
  return 'other';
}

/** How the landmark feed is cached (maps program b3): phones ask rarely, the server builds it rarely. */
export const LANDMARK_FEED_RULES = {
  /** A phone keeps the feed this long before asking again (with its etag). */
  maxAgeS: 6 * 60 * 60,
  /** The server rebuilds a city's feed at most this often (a landmark saved or a photo approved drops it sooner). */
  serverTtlMs: 60_000,
  /** Signed photo links in the feed stay valid this long, well past a phone's `maxAgeS`. */
  photoValidMs: 2 * 24 * 60 * 60 * 1000,
} as const;

export const LandmarkFeedInput = z.object({
  cityId: CityId.default('aziziyah'),
  /** The etag of the feed the phone already has: an unchanged feed answers `changed: false` only. */
  etag: z.string().min(1).max(64).optional(),
});
export type LandmarkFeedInput = z.input<typeof LandmarkFeedInput>;

/** One landmark on the map: no owner, no note, no zone — public city knowledge only. */
export const LandmarkFeedItem = z.object({
  id: z.string(),
  name_ar: z.string(),
  category: LandmarkCategory,
  pin: LatLng,
  /** An approved photo (signed read link, valid `photoValidMs`); null when none is approved yet. */
  photoUrl: z.string().nullable(),
});
export type LandmarkFeedItem = z.infer<typeof LandmarkFeedItem>;

/**
 * `places.landmarkFeed`: the city's approved landmarks, or only "unchanged" when the phone's etag
 * still matches. tRPC batches requests, so the etag travels in the input rather than `If-None-Match`.
 */
export const LandmarkFeed = z.discriminatedUnion('changed', [
  z.object({ changed: z.literal(false), etag: z.string(), maxAgeS: z.number().int().positive() }),
  z.object({ changed: z.literal(true), etag: z.string(), maxAgeS: z.number().int().positive(), landmarks: z.array(LandmarkFeedItem) }),
]);
export type LandmarkFeed = z.infer<typeof LandmarkFeed>;
