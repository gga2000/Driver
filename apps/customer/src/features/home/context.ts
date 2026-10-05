/**
 * The contextual card(s) under the services on home (audit C-09). What is happening now always
 * shows — the order or ride in progress, a booked الرجعة seat (both, in the rare case of both) —
 * and only when nothing is, ONE card: "اطلبه مرة ثانية" for the last delivered meal, otherwise the
 * الرجعة board (cars leaving for Aziziyah).
 */
export type HomeContext = 'active' | 'rajaa_trip' | 'reorder' | 'rajaa';

export function homeContext(input: { active: boolean; rajaaTrip: boolean; reorder: boolean }): HomeContext[] {
  const now: HomeContext[] = [];
  if (input.active) now.push('active');
  if (input.rajaaTrip) now.push('rajaa_trip');
  if (now.length > 0) return now;
  return [input.reorder ? 'reorder' : 'rajaa'];
}
