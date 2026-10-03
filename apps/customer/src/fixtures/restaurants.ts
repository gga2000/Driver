/**
 * FIXTURE — not API data.
 *
 * Restaurants now come from `catalog.restaurants` (see `src/features/home/queries.ts`). What stays
 * here is the neighbourhood deal card: promotions have no customer read yet (the API resolves no
 * promotion at all today), so the card is sample copy pointing at a real kitchen by name.
 * TODO(api): replace with a promotions read when the promotions module ships.
 */
export const FIXTURE_COMMUNITY_DEAL = {
  restaurantName: 'مشويات الحاج كريم',
  body: 'اطلبوا سوية من مشويات الحاج كريم وكل واحد ياخذ نقاط أصنافه',
} as const;
