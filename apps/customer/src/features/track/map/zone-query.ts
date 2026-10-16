/**
 * Zone outlines change a few times a year, and the customer screens only draw them (speed audit d2:
 * refetching them every 30 s was about 44% of a live order's data). Fetched once per app start and kept;
 * the built-in outlines show until the first answer.
 */
export const ZONE_SHAPES_QUERY = {
  staleTime: 6 * 60 * 60_000,
  gcTime: 24 * 60 * 60_000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;
