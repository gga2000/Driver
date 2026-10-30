/**
 * Zone outlines change when ops redraws them in the Console, so a screen reopened later must show the new
 * ones (not the ones from hours ago), but refetching them every 30 s was about 44% of a live order's data
 * (speed audit d2). Fresh for 10 minutes, refetched when the app comes back to the front once stale; the
 * built-in outlines show until the first answer.
 */
export const ZONE_SHAPES_QUERY = {
  staleTime: 10 * 60_000,
  gcTime: 24 * 60 * 60_000,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
} as const;
