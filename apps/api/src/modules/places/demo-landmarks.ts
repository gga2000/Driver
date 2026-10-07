import { foldArabic, type LandmarkCategory } from '@driver/contracts';
import type { PlacesService } from './places.service.js';

export interface DemoLandmark {
  name: string;
  category: LandmarkCategory;
  lat: number;
  lng: number;
  /** The zone it sits in (for the reader; the API resolves zones from the pin). */
  zone: 'centre' | 'street_30' | 'zakur';
}

/**
 * Approved landmark places for the demo APIs (maps program b3): a handful around the
 * centre, شارع 30 and زاكور (where the demo customer lives: the mosque and the market about 100 m
 * north and south of the home, the clinic and the school about 150 m west and east, so both the
 * customer's tall door camera and the courier's wide job map show some), one of each category the map draws —
 * the seed already has the garages, the grand mosque's gate and the two bridges. DEMO pins and names:
 * real landmarks come from field ops and the Console, never from here.
 */
export const DEMO_LANDMARKS: readonly DemoLandmark[] = [
  { name: 'سوق العزيزية', category: 'market', lat: 32.9056, lng: 45.0607, zone: 'centre' },
  { name: 'مستشفى العزيزية العام', category: 'clinic', lat: 32.9041, lng: 45.0575, zone: 'centre' },
  { name: 'مدرسة العزيزية الابتدائية', category: 'school', lat: 32.9036, lng: 45.0617, zone: 'centre' },
  { name: 'جامع شارع 30', category: 'mosque', lat: 32.9088, lng: 45.0621, zone: 'street_30' },
  { name: 'محطة وقود شارع 30', category: 'fuel', lat: 32.9105, lng: 45.0653, zone: 'street_30' },
  { name: 'إعدادية العزيزية للبنين', category: 'school', lat: 32.9112, lng: 45.0617, zone: 'street_30' },
  { name: 'جامع زاكور الكبير', category: 'mosque', lat: 32.8878, lng: 45.0768, zone: 'zakur' },
  { name: 'سوك زاكور', category: 'market', lat: 32.8861, lng: 45.0759, zone: 'zakur' },
  { name: 'مدرسة زاكور الابتدائية', category: 'school', lat: 32.8868, lng: 45.0782, zone: 'zakur' },
  { name: 'مستوصف زاكور', category: 'clinic', lat: 32.8872, lng: 45.075, zone: 'zakur' },
  { name: 'بانزينخانة زاكور', category: 'fuel', lat: 32.8846, lng: 45.0806, zone: 'zakur' },
];

/**
 * Saves the demo landmarks as approved landmark places, skipping any whose name the city already has
 * (a demo section may have added it). Returns how many were added.
 */
export async function seedDemoLandmarks(places: Pick<PlacesService, 'landmarks' | 'save'>, cityId = 'aziziyah'): Promise<number> {
  const have = new Set((await places.landmarks(cityId)).map((p) => foldArabic(p.name)));
  let added = 0;
  for (const l of DEMO_LANDMARKS) {
    if (have.has(foldArabic(l.name))) continue;
    await places.save({ cityId, pin: { lat: l.lat, lng: l.lng }, name: l.name, photos: [], confidence: 1, sharedWith: [], landmark: true, landmarkCategory: l.category, landmarkState: 'approved' });
    have.add(foldArabic(l.name));
    added += 1;
  }
  return added;
}
