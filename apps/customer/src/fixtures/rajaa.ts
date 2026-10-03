/**
 * FIXTURE — static sample for the الرجعة card on home.
 *
 * TODO(api): replace with the intercity departures board (garage objects, live seats) when the
 * intercity API lands; the card reads `useRajaaSummary()` in src/features/home/queries.ts.
 */
export const FIXTURE_RAJAA = {
  from: 'بغداد',
  to: 'العزيزية',
  garage: 'كراج النهضة',
  summary: 'سيارتين هسة، أقربها الساعة 5:30',
  seatsLeft: 3,
} as const;
