/**
 * The contextual card(s) under the services on home (audit C-09). What is happening now always
 * shows — the order or ride in progress, a booked الرجعة seat (both, in the rare case of both) —
 * and only when nothing is, ONE card: «غدا الجمعة» when a Friday usual can be booked (joy s3), else
 * «طلبك المعتاد؟» when a usual fits the hour, else "اطلبه مرة ثانية" for the last delivered meal,
 * otherwise none: the Baghdad/Kut and الرجعة tiles above already show the next cars (Date & Saffron,
 * Ali 2026-10-06: no second الرجعة card under its tile).
 */
export type HomeContext = 'active' | 'rajaa_trip' | 'friday' | 'usual' | 'reorder';

export function homeContext(input: { active: boolean; rajaaTrip: boolean; reorder: boolean; friday?: boolean; usual?: boolean }): HomeContext[] {
  const now: HomeContext[] = [];
  if (input.active) now.push('active');
  if (input.rajaaTrip) now.push('rajaa_trip');
  if (now.length > 0) return now;
  if (input.friday) return ['friday'];
  if (input.usual) return ['usual'];
  return input.reorder ? ['reorder'] : [];
}
