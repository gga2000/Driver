import type { ZoneTier } from './city-config.js';

/**
 * The 34 Aziziyah (العزيزية, Wasit) zones from `docs/specs/aziziyah-zones-seed.md`.
 *
 * `extId` is the courier-company location id kept for import mapping. Tiers are the draft
 * distance bands that price delivery (centre/near↔near 500; near↔mid 1,000; any↔far 1,500;
 * edge 2,000). Centroids are AI-drafted around the town centre (32.905 N, 45.06 E) and
 * consistent with the tier distances (near < 1.5 km, mid 1.5–4 km, far 4 km+, edge beyond);
 * drivers verify them once in Partner before prices are trusted (plan decision 1).
 * `radiusM` is the draft polygon radius the seed uses to build a hexagon.
 */
export interface AziziyahZoneSeed {
  id: string;
  extId: string;
  name_ar: string;
  name_en: string;
  tier: ZoneTier;
  group: string;
  lat: number;
  lng: number;
  radiusM: number;
}

export const AZIZIYAH_CENTRE = { lat: 32.905, lng: 45.06 } as const;

export const AZIZIYAH_ZONES: readonly AziziyahZoneSeed[] = [
  // ── centre (≤ ~0.7 km)
  { id: 'centre', extId: '5854', name_ar: 'العزيزية (مركز)', name_en: 'Aziziyah centre', tier: 'centre', group: 'centre', lat: 32.905, lng: 45.06, radiusM: 450 },
  { id: 'street_30', extId: '5060', name_ar: 'شارع ٣٠', name_en: 'Street 30', tier: 'centre', group: 'centre', lat: 32.9095, lng: 45.0635, radiusM: 350 },
  { id: 'nakheel_street', extId: '5090', name_ar: 'شارع نخيل', name_en: 'Nakheel Street', tier: 'centre', group: 'centre', lat: 32.9018, lng: 45.0558, radiusM: 350 },
  // ── near (~0.8–1.4 km)
  { id: 'mahdood_1', extId: '5066', name_ar: 'داخل محدود اولى', name_en: 'Mahdood 1', tier: 'near', group: 'محدود', lat: 32.9125, lng: 45.0545, radiusM: 400 },
  { id: 'mahdood_2', extId: '5067', name_ar: 'داخل محدود ثانية', name_en: 'Mahdood 2', tier: 'near', group: 'محدود', lat: 32.9165, lng: 45.0585, radiusM: 400 },
  { id: 'area_150', extId: '5059', name_ar: 'منطقة 150', name_en: 'Area 150', tier: 'near', group: 'centre-east', lat: 32.9075, lng: 45.0715, radiusM: 400 },
  { id: 'hashimi', extId: '4874', name_ar: 'الهاشمي', name_en: 'Al-Hashimi', tier: 'near', group: 'near', lat: 32.896, lng: 45.0675, radiusM: 400 },
  { id: 'shukri', extId: '5065', name_ar: 'الشكري', name_en: 'Al-Shukri', tier: 'near', group: 'near', lat: 32.8945, lng: 45.0545, radiusM: 400 },
  { id: 'saadouniya', extId: '5068', name_ar: 'السعدونية', name_en: 'Al-Saadouniya', tier: 'near', group: 'near', lat: 32.9005, lng: 45.0465, radiusM: 400 },
  { id: 'fidaa', extId: '5084', name_ar: 'الفداء', name_en: 'Al-Fidaa', tier: 'near', group: 'near', lat: 32.9135, lng: 45.067, radiusM: 400 },
  // ── mid (~1.6–3.6 km)
  { id: 'qutniya', extId: '5082', name_ar: 'القطنية', name_en: 'Al-Qutniya', tier: 'mid', group: 'mid', lat: 32.922, lng: 45.0495, radiusM: 500 },
  { id: 'nakra', extId: '5073', name_ar: 'نكره', name_en: 'Nakra', tier: 'mid', group: 'mid', lat: 32.9235, lng: 45.0695, radiusM: 500 },
  { id: 'zakur', extId: '5061', name_ar: 'زاكور', name_en: 'Zakur', tier: 'mid', group: 'mid', lat: 32.887, lng: 45.0765, radiusM: 500 },
  { id: 'jashaam', extId: '5070', name_ar: 'الجشعم', name_en: 'Al-Jashaam', tier: 'mid', group: 'mid', lat: 32.8835, lng: 45.0505, radiusM: 500 },
  { id: 'hawas_tujjar', extId: '5062', name_ar: 'حواس شارع تجار', name_en: 'Hawas – Tujjar Street', tier: 'mid', group: 'حواس', lat: 32.9245, lng: 45.0335, radiusM: 450 },
  { id: 'hawas_abbas', extId: '5063', name_ar: 'حواس حي العباس', name_en: 'Hawas – Al-Abbas', tier: 'mid', group: 'حواس', lat: 32.9285, lng: 45.0385, radiusM: 450 },
  { id: 'hawas_umm_banin', extId: '5064', name_ar: 'حواس حي ام بنين', name_en: 'Hawas – Umm al-Banin', tier: 'mid', group: 'حواس', lat: 32.932, lng: 45.045, radiusM: 450 },
  { id: 'hawas_sabb', extId: '5086', name_ar: 'حواس شارع صب', name_en: 'Hawas – Sabb Street', tier: 'mid', group: 'حواس', lat: 32.9205, lng: 45.0275, radiusM: 450 },
  { id: 'hawas_bridge', extId: '5087', name_ar: 'جسر حواس', name_en: 'Hawas Bridge', tier: 'mid', group: 'حواس', lat: 32.917, lng: 45.0375, radiusM: 400 },
  { id: 'maamal_sus', extId: '5071', name_ar: 'معمل سوس', name_en: 'Maamal Sus', tier: 'mid', group: 'معمل سوس', lat: 32.8905, lng: 45.0885, radiusM: 450 },
  { id: 'maamal_sus_dour', extId: '5072', name_ar: 'معمل سوس الدور', name_en: 'Maamal Sus – Al-Dour', tier: 'mid', group: 'معمل سوس', lat: 32.8945, lng: 45.093, radiusM: 450 },
  { id: 'maamal_sus_abdullah', extId: '5077', name_ar: 'معمل سوس مطعم عبدالله', name_en: 'Maamal Sus – Abdullah Restaurant', tier: 'mid', group: 'معمل سوس', lat: 32.8865, lng: 45.0825, radiusM: 400 },
  { id: 'maamal_sus_2', extId: '5078', name_ar: 'معمل سوس ثانية', name_en: 'Maamal Sus 2', tier: 'mid', group: 'معمل سوس', lat: 32.8845, lng: 45.0905, radiusM: 450 },
  // ── far (~4–6 km)
  { id: 'khamas', extId: '5079', name_ar: 'الخماس', name_en: 'Al-Khamas', tier: 'far', group: 'خماس', lat: 32.942, lng: 45.085, radiusM: 600 },
  { id: 'khamas_rasool', extId: '5080', name_ar: 'خماس شارع رسول', name_en: 'Khamas – Rasool Street', tier: 'far', group: 'خماس', lat: 32.947, lng: 45.092, radiusM: 550 },
  { id: 'khamas_turabi', extId: '5081', name_ar: 'خماس شارع ترابي', name_en: 'Khamas – Turabi Street', tier: 'far', group: 'خماس', lat: 32.9385, lng: 45.097, radiusM: 550 },
  { id: 'khamas_bridge', extId: '5089', name_ar: 'جسر خماس', name_en: 'Khamas Bridge', tier: 'far', group: 'خماس', lat: 32.938, lng: 45.081, radiusM: 450 },
  { id: 'deir', extId: '5074', name_ar: 'الدير', name_en: 'Al-Deir', tier: 'far', group: 'الدير', lat: 32.8675, lng: 45.0355, radiusM: 600 },
  { id: 'deir_awsat', extId: '5075', name_ar: 'الدير الاوسط', name_en: 'Al-Deir Al-Awsat', tier: 'far', group: 'الدير', lat: 32.872, lng: 45.0255, radiusM: 550 },
  { id: 'brinj', extId: '5069', name_ar: 'برينج', name_en: 'Brinj', tier: 'far', group: 'برينج', lat: 32.868, lng: 45.0625, radiusM: 600 },
  { id: 'brinj_bridge', extId: '5088', name_ar: 'جسر برينج', name_en: 'Brinj Bridge', tier: 'far', group: 'برينج', lat: 32.8705, lng: 45.0735, radiusM: 450 },
  // ── edge (~6.5–8 km; tuktuk may refuse, car default)
  { id: 'bazl_hallata', extId: '5076', name_ar: 'بزل حلاته', name_en: 'Bazl Hallata', tier: 'edge', group: 'edge', lat: 32.959, lng: 45.0355, radiusM: 800 },
  { id: 'mashrou_owaid', extId: '5083', name_ar: 'مشروع عويد', name_en: 'Mashrou Owaid', tier: 'edge', group: 'edge', lat: 32.8485, lng: 45.0885, radiusM: 800 },
  { id: 'mashrou_jadhif', extId: '5085', name_ar: 'مشروع جضيف', name_en: 'Mashrou Jadhif', tier: 'edge', group: 'edge', lat: 32.9535, lng: 45.1095, radiusM: 800 },
];

/** Intercity destinations priced as zones of their own (garages are meeting points). */
export const INTERCITY_DESTINATIONS = [
  { id: 'kut', name_ar: 'الكوت', name_en: 'Kut', tier: 'edge' as const },
  { id: 'baghdad', name_ar: 'بغداد', name_en: 'Baghdad', tier: 'edge' as const },
] as const;
