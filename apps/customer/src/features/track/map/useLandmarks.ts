import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LANDMARK_FEED_RULES, type LandmarkFeedItem } from '@driver/contracts';
import { mergeLandmarkFeed, type LandmarkFeedCache } from '@driver/map';
import { useApiClient } from '@/lib/api';

const NONE: readonly LandmarkFeedItem[] = [];
/** Kept in memory a day after the last map closes (the feed changes rarely). */
const KEEP_MS = 24 * 60 * 60 * 1000;

/**
 * The city's landmarks for the map layer (maps program b3): asked once, then at most every
 * `maxAgeS` with the etag the phone has — an unchanged feed is a few bytes. Until it loads (or when
 * it cannot), the map simply has no landmarks; it is decoration, never in the way of the screen.
 */
export function useLandmarks(cityId = 'aziziyah'): readonly LandmarkFeedItem[] {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const key = ['landmark-feed', cityId] as const;
  const feed = useQuery({
    queryKey: key,
    queryFn: async (): Promise<LandmarkFeedCache> => {
      const prev = queryClient.getQueryData<LandmarkFeedCache>(key);
      const res = await client.places.landmarkFeed.query({ cityId, ...(prev?.etag ? { etag: prev.etag } : {}) });
      return mergeLandmarkFeed(prev, res);
    },
    staleTime: LANDMARK_FEED_RULES.maxAgeS * 1000,
    gcTime: KEEP_MS,
  });
  return feed.data?.landmarks ?? NONE;
}
