/**
 * One icon per kind of saved place, everywhere a place is drawn (A-06). The bag means food in this
 * app, so work (and the hospital saved as work) gets a briefcase. Plain strings, so it runs in Node
 * tests; every value is an `IconName` in `@driver/ui`.
 */
export type PlaceIcon = 'home' | 'briefcase' | 'user' | 'map-pin';

export function placeIcon(label: string): PlaceIcon {
  if (label === 'home') return 'home';
  if (label === 'work') return 'briefcase';
  if (label === 'family') return 'user';
  return 'map-pin';
}
