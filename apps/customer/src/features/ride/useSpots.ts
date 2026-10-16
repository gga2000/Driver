import { useMemo } from 'react';
import type { MessageKey } from '@driver/i18n';
import { placeLabelKey } from '@/features/places/PlaceForm';
import { useLocale, useT } from '@/lib/i18n';
import { deliveryPointOf, selectedPlace, useProfile, type SavedPlace } from '@/lib/profile';
import { landmarkSpot, shopSpot, zoneSpots, zoneTitle, type Spot, type SpotSources } from './logic';
import { useLandmarks, useShopPlaces } from './queries';
import { useRideStore } from './store';

const LANDMARK_KIND: Record<'garage' | 'meeting_point' | 'landmark', MessageKey> = {
  garage: 'ride.kind_garage',
  meeting_point: 'ride.kind_meeting_point',
  landmark: 'ride.kind_landmark',
};

export function savedSpot(p: SavedPlace, title: string, locale: 'ar-IQ' | 'en'): Spot {
  const point = deliveryPointOf(p);
  return {
    id: `saved:${p.id}`,
    kind: 'saved',
    title,
    subtitle: zoneTitle(p.zoneId, locale),
    zoneId: p.zoneId,
    pin: point.pin ?? { lat: 32.905, lng: 45.06 },
    savedLabel: p.label,
  };
}

/**
 * Everything "وين رايح؟" searches (saved places, recent trips, landmarks, restaurants, the 34 zones) and the
 * default pickup: the selected deliver-to place.
 */
export function useRideSpots(): { sources: SpotSources; defaultPickup: Spot | null; landmarksLoading: boolean; landmarksFailed: boolean; retryLandmarks: () => void } {
  const t = useT();
  const locale = useLocale();
  const prof = useProfile();
  const ride = useRideStore();
  const landmarks = useLandmarks();
  const refetchLandmarks = landmarks.refetch;
  const shops = useShopPlaces();
  const lang = locale === 'en' ? 'en' : 'ar-IQ';

  return useMemo(() => {
    const title = (p: SavedPlace) => p.title ?? t(placeLabelKey(p.label));
    const saved = prof.places.map((p) => savedSpot(p, title(p), lang));
    const sel = selectedPlace(prof);
    const defaultPickup = sel ? savedSpot(sel, title(sel), lang) : null;
    return {
      sources: {
        saved,
        recent: ride.recent,
        landmarks: (landmarks.data ?? []).map((l) => landmarkSpot(l, lang, t(LANDMARK_KIND[l.kind]))),
        shops: (shops.data ?? []).map((m) => shopSpot(m, lang, t('ride.kind_shop'))).filter((x): x is Spot => x !== null),
        zones: zoneSpots(lang, t('ride.zone_centre')),
      },
      defaultPickup,
      landmarksLoading: landmarks.isLoading,
      landmarksFailed: landmarks.isError && !landmarks.data,
      retryLandmarks: () => void refetchLandmarks(),
    };
  }, [prof, ride.recent, landmarks.data, landmarks.isLoading, landmarks.isError, refetchLandmarks, shops.data, lang, t]);
}
