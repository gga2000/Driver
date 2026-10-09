import { RIDE_SEAT_HOLD, type IntercityDirection } from '@driver/contracts';

/**
 * الرجعة network and rules (customer spec §2, domain §2, decisions §8–§9, review C). Data, not
 * code: garages are the seeded meeting points (`packages/db/prisma/seed-data.ts`, ids `mp_<key>`),
 * corridors carry their seat price, the on-the-way meeting points and the checkpoint geofences the
 * driver late meter is waived in.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 * │ PLACEHOLDERS — Ali must replace before launch (each is also marked `placeholder`/`draft`):  │
 * │  • Travel times (120 / 60 min), on-the-way meeting-point fees (1,000 / 2,000).              │
 * │  • The detour speed (door pickup 1,000 + 500 per km after 2 km: Ali kept it, 2026-10-07).   │
 * │  • The Kut garage, the three Baghdad-road meeting points and the three checkpoints: names   │
 * │    and pins are plausible drafts until field ops verify them on the ground.                 │
 * │  • The rider free-cancel rule (driver cancel fee 2,000, 4,000 after 18:00: Ali kept it).   │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 */

export interface GarageConfig {
  id: string;
  cityId: string;
  nameAr: string;
  nameEn: string;
  lat: number;
  lng: number;
  geofenceM: number;
  draft: boolean;
}

export interface MeetingPointConfig {
  id: string;
  nameAr: string;
  nameEn: string;
  lat: number;
  lng: number;
  feeIqd: number;
  photoUrl: string | null;
  draft: boolean;
}

export interface CheckpointConfig {
  id: string;
  nameAr: string;
  lat: number;
  lng: number;
  radiusM: number;
  draft: boolean;
}

export interface CorridorConfig {
  id: string;
  nameAr: string;
  nameEn: string;
  primary: boolean;
  /** The far end (the near end is always Aziziyah). */
  cityId: string;
  seatPriceIqd: number;
  frontPremiumIqd: number;
  /** True while the fare is a placeholder. */
  placeholderPrice: boolean;
  travelMin: number;
  meetingPoints: MeetingPointConfig[];
  checkpoints: CheckpointConfig[];
}

export const HOME_CITY = 'aziziyah';

export const GARAGES: GarageConfig[] = [
  {
    id: 'mp_garage_bab1',
    cityId: 'aziziyah',
    nameAr: 'كراج البوابة 1',
    nameEn: 'Gate 1 garage',
    lat: 32.9032,
    lng: 45.0578,
    geofenceM: 150,
    draft: false,
  },
  {
    id: 'mp_garage_bab2',
    cityId: 'aziziyah',
    nameAr: 'كراج البوابة 2',
    nameEn: 'Gate 2 garage',
    lat: 32.9088,
    lng: 45.0648,
    geofenceM: 150,
    draft: false,
  },
  {
    id: 'mp_garage_souq',
    cityId: 'aziziyah',
    nameAr: 'كراج السوق',
    nameEn: 'Souq garage',
    lat: 32.9062,
    lng: 45.0612,
    geofenceM: 150,
    draft: false,
  },
  {
    id: 'mp_garage_nahdha',
    cityId: 'baghdad',
    nameAr: 'كراج النهضة',
    nameEn: 'Al-Nahdha garage',
    lat: 33.3344,
    lng: 44.4165,
    geofenceM: 150,
    draft: false,
  },
  // DRAFT: the Kut end of the secondary corridor.
  {
    id: 'mp_garage_kut',
    cityId: 'kut',
    nameAr: 'كراج الكوت (مسودة)',
    nameEn: 'Kut garage (draft)',
    lat: 32.5126,
    lng: 45.8189,
    geofenceM: 150,
    draft: true,
  },
];

export const CORRIDORS: CorridorConfig[] = [
  {
    id: 'aziziyah_baghdad',
    nameAr: 'العزيزية ⇄ بغداد',
    nameEn: 'Aziziyah ⇄ Baghdad',
    primary: true,
    cityId: 'baghdad',
    seatPriceIqd: 5_000, // Ali 2026-10-07: 5,000 each way (garage → Baghdad and Baghdad → garage)
    frontPremiumIqd: 1_000, // Ali 2026-10-07
    placeholderPrice: false,
    travelMin: 120, // PLACEHOLDER estimate
    meetingPoints: [
      // DRAFT pins and fees (seeded as INTERCITY_DRAFT_POINTS)
      {
        id: 'mp_ic_aziziyah_north_exit',
        nameAr: 'مدخل العزيزية الشمالي (مسودة)',
        nameEn: 'Aziziyah north entrance (draft)',
        lat: 32.9455,
        lng: 45.0296,
        feeIqd: 1_000,
        photoUrl: null,
        draft: true,
      },
      {
        id: 'mp_ic_madain_junction',
        nameAr: 'مفرق المدائن (مسودة)',
        nameEn: 'Al-Mada’in junction (draft)',
        lat: 33.0985,
        lng: 44.5802,
        feeIqd: 2_000,
        photoUrl: null,
        draft: true,
      },
      {
        id: 'mp_ic_diyala_bridge',
        nameAr: 'جسر ديالى (مسودة)',
        nameEn: 'Diyala bridge (draft)',
        lat: 33.2348,
        lng: 44.5231,
        feeIqd: 2_000,
        photoUrl: null,
        draft: true,
      },
    ],
    checkpoints: [
      // DRAFT: Baghdad-road checkpoints (review C-39) — the driver meter is waived for a stop inside one.
      {
        id: 'cp_aziziyah_north',
        nameAr: 'سيطرة العزيزية الشمالية (مسودة)',
        lat: 32.948,
        lng: 45.024,
        radiusM: 300,
        draft: true,
      },
      {
        id: 'cp_madain',
        nameAr: 'سيطرة المدائن (مسودة)',
        lat: 33.101,
        lng: 44.585,
        radiusM: 300,
        draft: true,
      },
      {
        id: 'cp_diyala_bridge',
        nameAr: 'سيطرة جسر ديالى (مسودة)',
        lat: 33.233,
        lng: 44.52,
        radiusM: 300,
        draft: true,
      },
    ],
  },
  {
    id: 'aziziyah_kut',
    nameAr: 'العزيزية ⇄ الكوت',
    nameEn: 'Aziziyah ⇄ Kut',
    primary: false,
    cityId: 'kut',
    seatPriceIqd: 5_000, // Ali 2026-10-07: 5,000 each way
    frontPremiumIqd: 1_000, // Ali 2026-10-07
    placeholderPrice: false,
    travelMin: 60, // PLACEHOLDER estimate
    meetingPoints: [],
    checkpoints: [],
  },
];

/** Operating rules; every figure is config (money spec: "config per city/zone, not code"). */
export interface IntercityRules {
  /** Hold a seat free for this long (domain §2: 10 min). */
  holdMin: number;
  /** T−30: boarding opens, low-fill check, boarding pass and live car. */
  boardingWindowMin: number;
  /** Fewer than this many seats (walk-ups after the selfie included) at T−30 → cancelled_low_fill. */
  minSeatsAtTMinus30: number;
  /**
   * Product decision 2026-10-04: the low-fill cancel never fires before the announced time minus
   * this; a car announced less than `boardingWindowMin` ahead is judged only at its latest departure.
   */
  lowFillNotBeforeMin?: number;
  /** Latest departure may be at most this long after the announced time. */
  maxLatestDepartureMin: number;
  /** Announcements at most this far ahead. */
  maxAnnounceAheadHours: number;
  /** Cash reservations: grace before the driver may leave without the rider (no meter). */
  cashGraceMin: number;
  /**
   * x3 (RIDE_SEAT_HOLD): a rider whose taxi from us runs late for the car keeps his seat until that taxi
   * is due, capped at the late meter's cap after the announced time. Off until Ali confirms the
   * no-show rule (2026-10-07); absent = off.
   */
  seatHoldForLateTaxi?: boolean;
  /** Cash reservation rights lost after this many no-shows (claimed-demand lapses count). */
  cashNoShowsToRevoke: number;
  /** Review C-35: trusted rider after this many completed seats. */
  trustedAfterSeats: number;
  /** Moves after a cancellation / forfeit look this far ahead (decisions §8: 2 h). */
  moveWindowMin: number;
  /** Driver cancel inside this many minutes before departure costs a fee (domain §2: 2 h). */
  driverCancelFeeWindowMin: number;
  /** Fee per affected rider, paid to them as credit (review C-46: 2,000 per rider). */
  driverCancelFeePerRiderIqd: number;
  /** Fee doubles for departures at or after this local hour (review C-46: 18:00). */
  cancelFeeDoublesFromHour: number;
  /** Baghdad time (UTC+3, no DST). */
  utcOffsetMin: number;
  /** Door pickups (review C-37). */
  door: {
    maxPerDeparture: number;
    maxDetourMin: number;
    baseFeeIqd: number;
    perKmIqd: number;
    freeKm: number;
    maxKm: number;
    speedKmh: number;
    roadFactor: number;
  };
  /** Review C-36: rider > this far from the chosen meeting point warns both. */
  meetingPointMismatchM: number;
  /** Review C-33: walk-up share above this over the last N departures flags a garage check. */
  walkUpShareFlag: { share: number; departures: number };
  /** Departures close this long after arrival (domain §2 arrived → closed). */
  closeAfterArrivalMin: number;
  /** Rider may cancel a prepaid seat free until boarding opens (T−30); cash any time before departure. */
  riderFreeCancelUntilBoarding: boolean;
  /** Request board (review C-50). */
  requestBoard: {
    depositRate: number;
    depositMinIqd: number;
    offerStepIqd: number;
    expireAfterMin: number;
    riderNoShowWaitMin: number;
    driverNoShowAfterMin: number;
    arrivalGeofenceM: number;
    /** Way C (Ali 2026-10-09): a friend's «صعدت» works within this of where the driver pressed «وصلت». */
    shareBoardNearM: number;
  };
}

export const INTERCITY_RULES: IntercityRules = {
  holdMin: 10,
  boardingWindowMin: 30,
  minSeatsAtTMinus30: 3,
  lowFillNotBeforeMin: 10,
  maxLatestDepartureMin: 120,
  maxAnnounceAheadHours: 48,
  cashGraceMin: 3,
  seatHoldForLateTaxi: RIDE_SEAT_HOLD,
  cashNoShowsToRevoke: 2,
  trustedAfterSeats: 3,
  moveWindowMin: 120,
  driverCancelFeeWindowMin: 120,
  driverCancelFeePerRiderIqd: 2_000, // PLACEHOLDER (review C-46 figure)
  cancelFeeDoublesFromHour: 18,
  utcOffsetMin: 180,
  door: {
    maxPerDeparture: 2,
    maxDetourMin: 15,
    baseFeeIqd: 1_000,
    perKmIqd: 500,
    freeKm: 2,
    maxKm: 10,
    speedKmh: 30,
    roadFactor: 1.3,
  }, // fees PLACEHOLDER
  meetingPointMismatchM: 300,
  walkUpShareFlag: { share: 0.6, departures: 5 },
  closeAfterArrivalMin: 120,
  riderFreeCancelUntilBoarding: true,
  requestBoard: {
    depositRate: 0.2,
    depositMinIqd: 5_000,
    offerStepIqd: 1_000,
    expireAfterMin: 60,
    riderNoShowWaitMin: 10,
    driverNoShowAfterMin: 20,
    arrivalGeofenceM: 300,
    shareBoardNearM: 300,
  },
};

// ───────────────────────── lookups ─────────────────────────

export interface IntercityNetworkConfig {
  garages: GarageConfig[];
  corridors: CorridorConfig[];
}

export const INTERCITY_NETWORK: IntercityNetworkConfig = { garages: GARAGES, corridors: CORRIDORS };

/** Direction of a run leaving from a garage in `cityId`. */
export function directionFrom(cityId: string): IntercityDirection {
  return cityId === HOME_CITY ? 'from_aziziyah' : 'to_aziziyah';
}

/** The city a departure in `direction` on `corridor` leaves from. */
export function originCity(corridor: CorridorConfig, direction: IntercityDirection): string {
  return direction === 'from_aziziyah' ? HOME_CITY : corridor.cityId;
}

export function destinationCity(corridor: CorridorConfig, direction: IntercityDirection): string {
  return direction === 'from_aziziyah' ? corridor.cityId : HOME_CITY;
}
