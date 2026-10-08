/**
 * Aziziyah landmarks every rider can search for ("وين رايح؟"): the three town garages and the
 * neighbourhood street-pickup meeting points. Mirrors `MEETING_POINTS` in
 * `packages/db/prisma/seed-data.ts` (keys, names and pins must stay in step) — DRAFT pins until field
 * ops verify them; photo-verified landmarks from the `places` table join them at runtime
 * (`places.landmarks`).
 */
export interface AziziyahLandmarkSeed {
  key: string;
  name_ar: string;
  name_en: string;
  /** Zone the pin falls in (seed's `zoneKey`). */
  zoneId: string;
  lat: number;
  lng: number;
  kind: 'garage' | 'meeting_point';
  /** Other names people use for it, searched too. */
  aliases_ar?: readonly string[];
}

export const AZIZIYAH_LANDMARKS: readonly AziziyahLandmarkSeed[] = [
  { key: 'garage_bab1', name_ar: 'كراج البوابة ١', name_en: 'Gate 1 garage', zoneId: 'centre', lat: 32.9032, lng: 45.0578, kind: 'garage', aliases_ar: ['كراج بغداد'] },
  { key: 'garage_bab2', name_ar: 'كراج البوابة ٢', name_en: 'Gate 2 garage', zoneId: 'street_30', lat: 32.9088, lng: 45.0648, kind: 'garage', aliases_ar: ['كراج الكوت'] },
  { key: 'garage_souq', name_ar: 'كراج السوق', name_en: 'Souq garage', zoneId: 'centre', lat: 32.9062, lng: 45.0612, kind: 'garage', aliases_ar: ['السوق'] },
  { key: 'mp_jami_kabir', name_ar: 'باب الجامع الكبير', name_en: 'Grand Mosque gate', zoneId: 'centre', lat: 32.9045, lng: 45.0595, kind: 'meeting_point', aliases_ar: ['الجامع الكبير', 'جامع'] },
  { key: 'mp_hadiqat_shasha', name_ar: 'حديقة الشاشة', name_en: 'Al-Shasha park', zoneId: 'mahdood_1', lat: 32.9122, lng: 45.0552, kind: 'meeting_point', aliases_ar: ['الحديقة', 'متنزه'] },
  { key: 'mp_kuliyat_tarbiya', name_ar: 'باب كلية التربية الأساسية', name_en: 'College of Basic Education gate', zoneId: 'saadouniya', lat: 32.9012, lng: 45.0478, kind: 'meeting_point', aliases_ar: ['الكلية', 'كلية التربية'] },
  { key: 'mp_shari_30', name_ar: 'تقاطع شارع 30', name_en: 'Street 30 junction', zoneId: 'street_30', lat: 32.9098, lng: 45.0628, kind: 'meeting_point' },
  { key: 'mp_hawas_bridge', name_ar: 'رأس جسر حواس', name_en: 'Hawas bridge head', zoneId: 'hawas_bridge', lat: 32.9172, lng: 45.0378, kind: 'meeting_point', aliases_ar: ['جسر حواس'] },
  { key: 'mp_khamas_bridge', name_ar: 'رأس جسر خماس', name_en: 'Khamas bridge head', zoneId: 'khamas_bridge', lat: 32.9382, lng: 45.0812, kind: 'meeting_point', aliases_ar: ['جسر خماس'] },
];
