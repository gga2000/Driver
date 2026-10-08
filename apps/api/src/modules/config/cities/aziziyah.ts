import type { CityPricingConfig, ComponentRule, DispatchConfig, TierFare, ZoneConfig, ZoneFare } from '@driver/contracts';
import { AZIZIYAH_ZONES, INTERCITY_DESTINATIONS } from '@driver/contracts';

/**
 * Aziziyah (العزيزية), Wasit — launch city. All amounts are IQD integers and all of this is config.
 *
 * Zones: the 34 seed zones (docs/specs/aziziyah-zones-seed.md) in five tiers, plus the two intercity
 * destinations. City verticals price by tier pair (dispatch & pricing spec §1); exact zone pairs may
 * be added later and win over the tier table. Intercity uses explicit zone rows.
 */

const zones: ZoneConfig[] = [
  ...AZIZIYAH_ZONES.map(({ id, name_ar, name_en, tier, extId }) => ({ id, name_ar, name_en, tier, extId })),
  ...INTERCITY_DESTINATIONS.map((d) => ({ ...d })),
];

/**
 * Delivery fee by tier pair (money §2 bands, spec §1 tier pairs). Order matters: specific rows first,
 * `any` wildcards after, and edge before far so "far ↔ edge" resolves to 2,000.
 */
const deliveryTierFares: TierFare[] = [
  { from: 'any', to: 'edge', fare: 2000 },
  { from: 'any', to: 'far', fare: 1500 },
  { from: 'centre', to: 'centre', fare: 500 },
  { from: 'centre', to: 'near', fare: 500 },
  { from: 'near', to: 'near', fare: 500 },
  { from: 'centre', to: 'mid', fare: 1000 },
  { from: 'near', to: 'mid', fare: 1000 },
  { from: 'mid', to: 'mid', fare: 1000 },
];

/** City ride fares by tier pair — draft until Plan 3 real Aziziyah prices land; tuktuk is 1,000 below car. */
const carTierFares: TierFare[] = [
  { from: 'any', to: 'edge', fare: 7000 },
  { from: 'any', to: 'far', fare: 6000 },
  { from: 'centre', to: 'centre', fare: 3000 },
  { from: 'centre', to: 'near', fare: 3000 },
  { from: 'near', to: 'near', fare: 3500 },
  { from: 'centre', to: 'mid', fare: 4000 },
  { from: 'near', to: 'mid', fare: 4000 },
  { from: 'mid', to: 'mid', fare: 4500 },
];
const tuktukTierFares: TierFare[] = carTierFares.map((r) => ({ ...r, fare: Math.max(2000, r.fare - 1000) }));

/**
 * Intercity: every Aziziyah zone → Kut 5,000, → Baghdad 5,000 (Ali 2026-10-07, each way); garages are
 * meeting points. These mirror the seat prices the الرجعة board charges (`routes/intercity.config.ts`
 * `seatPriceIqd`); change both together.
 * There is no Kut ⇄ Baghdad line.
 */
const intercityFares: ZoneFare[] = [
  ...AZIZIYAH_ZONES.map((z) => ({ from: z.id, to: 'kut', fare: 5000 })),
  ...AZIZIYAH_ZONES.map((z) => ({ from: z.id, to: 'baghdad', fare: 5000 })),
];

// ───────────────────────── component rules ─────────────────────────

/** Shared metered rules: always computed, hidden until a city/vertical flips visibility. */
const shadowDistance: ComponentRule = {
  key: 'distance',
  label_ar: 'المسافة',
  label_en: 'Distance',
  driverShareRule: 'driver_commissioned',
  visibility: 'shadow',
  perUnit: 500, // IQD per km
};
const shadowTime: ComponentRule = {
  key: 'time',
  label_ar: 'الوقت',
  label_en: 'Time',
  driverShareRule: 'driver_commissioned',
  visibility: 'shadow',
  perUnit: 100, // IQD per minute
};
const rideBase: ComponentRule = {
  key: 'base',
  label_ar: 'السعر الأساسي',
  label_en: 'Base fare',
  driverShareRule: 'driver_commissioned',
  visibility: 'shown',
};
/** Delivery fees pass through to the courier in full (money §2). */
const deliveryBase: ComponentRule = {
  key: 'base',
  label_ar: 'أجرة التوصيل',
  label_en: 'Delivery fee',
  driverShareRule: 'driver_full',
  visibility: 'shown',
};
const serviceFee: ComponentRule = {
  key: 'service_fee',
  label_ar: 'رسوم الخدمة',
  label_en: 'Service fee',
  driverShareRule: 'platform_only',
  visibility: 'shown',
  amount: 500,
};
const rideDoorPickup: ComponentRule = {
  key: 'door_pickup',
  label_ar: 'نجيك للباب',
  label_en: 'Door pickup',
  driverShareRule: 'driver_full',
  visibility: 'shown',
  amount: 1000,
};
const rideStreetPickup: ComponentRule = {
  key: 'street_pickup',
  label_ar: 'تلاقينا بالشارع',
  label_en: 'Street pickup',
  driverShareRule: 'driver_full',
  visibility: 'shown',
  amount: 0,
};
/** Delivery: street-point handover −250; door pickup for errands/parcels +500 (money §2). */
const deliveryStreetHandover: ComponentRule = {
  key: 'street_pickup',
  label_ar: 'تسليم بالشارع',
  label_en: 'Street handover',
  driverShareRule: 'driver_full',
  visibility: 'shown',
  amount: -250,
};
const deliveryDoor: ComponentRule = {
  key: 'door_pickup',
  label_ar: 'للباب',
  label_en: 'To the door',
  driverShareRule: 'driver_full',
  visibility: 'shown',
  amount: 0,
};
const errandDoorPickup: ComponentRule = { ...deliveryDoor, label_ar: 'استلام من الباب', label_en: 'Door pickup', amount: 500 };
const wait: ComponentRule = {
  key: 'wait',
  label_ar: 'انتظار',
  label_en: 'Waiting',
  driverShareRule: 'driver_full',
  visibility: 'shown',
  // IQD per paid minute after the 3 free ones (the engine bills perUnit × waitMinutes). Nothing charges
  // waiting yet (every caller passes waitMinutes: 0) and the customer app promises no paid wait until
  // Ali sets the number (price sheet #30).
  perUnit: 250,
};
const rideNight: ComponentRule = {
  key: 'night',
  label_ar: 'رسوم الليل',
  label_en: 'Night fee',
  driverShareRule: 'driver_full',
  visibility: 'shown',
  amount: 1000,
  hours: [23, 5],
};
/** Food's night fee starts at midnight, not 23:00 like rides (Ali, 2026-10-07: «250 after 12am»). */
const deliveryNight: ComponentRule = { ...rideNight, amount: 250, hours: [0, 5] };
const promo: ComponentRule = {
  key: 'promo',
  label_ar: 'خصم',
  label_en: 'Discount',
  driverShareRule: 'platform_only',
  visibility: 'shown',
};
const frontSeat: ComponentRule = {
  key: 'front_seat',
  label_ar: 'مقعد أمامي',
  label_en: 'Front seat',
  driverShareRule: 'driver_full',
  visibility: 'shown',
  amount: 1000, // Ali 2026-10-07 (was 2,000); same as frontPremiumIqd in routes/intercity.config.ts
};

// ───────────────────────── dispatch (plan Step 5, spec §3) ─────────────────────────

const smartBroadcast: DispatchConfig = {
  policy: 'smart_broadcast',
  waves: [
    { size: 3, radiusKm: 1.5, seconds: 15 },
    { size: 5, radiusKm: 3, seconds: 15 },
    { size: 'all', seconds: 30 },
  ],
  maxBatch: 1,
  acceptTimeoutSec: 15,
  suggestOnly: false,
  rebroadcastAfterSec: 60,
  rebroadcastCompensationIqd: 500,
  customerFreeCancelAfterSec: 180,
  passes: 1,
  arriveBeforeReadyMin: 0,
  batchMaxDetourMin: 0,
  batchMaxHotWaitMin: 0,
  minSeatsByTMinus30: 0,
  substituteWaves: 1,
  substituteWaveSize: 1,
  substituteWaveMin: 1,
  rankWeights: { distance: 40, tier: 30, load: 20, vehicleFit: 10 },
  offerSeenAfterSec: 3,
};

/**
 * Taxi and tuktuk: the smart broadcast, plus the evening-before pre-assignment of rides booked for later
 * (edge-case review #28, adopted): offered from 18:00 the evening before, confirmed by 22:00 (a same-day
 * ride booked 3 h ahead: by 90 min before, asked 08:00–22:00 only), the favourite alone for the first
 * hour, the confirmed driver reminded an hour before and started at T−30, else the T−30 search.
 */
const rides: DispatchConfig = {
  ...smartBroadcast,
  bookedRides: {
    offerFromHour: 18,
    confirmByHour: 22,
    sameDayMinLeadMin: 180,
    sameDayConfirmLeadMin: 90,
    sameDayFromHour: 8,
    minOfferWindowMin: 30,
    favouriteFirstMin: 60,
    reminderLeadMin: 60,
    minGapMin: 60,
    notifyDrivers: 10,
  },
};

const autoAssign: DispatchConfig = {
  ...smartBroadcast,
  policy: 'auto_assign',
  waves: undefined,
  maxBatch: 2, // bikes; tuktuks allow 3 (vehicle-class override in the dispatch module)
  acceptTimeoutSec: 20,
  passes: 3,
  arriveBeforeReadyMin: 2,
  batchMaxDetourMin: 4,
  batchMaxHotWaitMin: 10,
};

const scheduled: DispatchConfig = {
  ...smartBroadcast,
  policy: 'scheduled',
  waves: undefined,
  acceptTimeoutSec: 60,
  minSeatsByTMinus30: 3,
};

const preAssigned: DispatchConfig = {
  ...smartBroadcast,
  policy: 'pre_assigned',
  waves: undefined,
  acceptTimeoutSec: 60,
  substituteWaves: 2,
  substituteWaveSize: 3,
  substituteWaveMin: 5,
};

// ───────────────────────── the city ─────────────────────────

export const aziziyah: CityPricingConfig = {
  cityId: 'aziziyah',
  name_ar: 'العزيزية',
  name_en: 'Aziziyah',
  timezone: 'Asia/Baghdad',
  roundingStep: 250,
  zones,
  verticals: [
    {
      vertical: 'taxi',
      zoneFares: [],
      tierFares: carTierFares,
      defaultFare: 5000,
      components: [rideBase, shadowDistance, shadowTime, rideDoorPickup, rideStreetPickup, wait, rideNight, promo],
      floor: 3000,
      ceiling: 25000,
    },
    {
      vertical: 'tuktuk',
      zoneFares: [],
      tierFares: tuktukTierFares,
      defaultFare: 4000,
      components: [rideBase, shadowDistance, shadowTime, rideDoorPickup, rideStreetPickup, wait, rideNight, promo],
      floor: 2000,
      ceiling: 15000,
    },
    {
      vertical: 'food',
      zoneFares: [],
      tierFares: deliveryTierFares,
      defaultFare: 1500,
      components: [deliveryBase, serviceFee, shadowDistance, shadowTime, deliveryDoor, deliveryStreetHandover, deliveryNight, promo],
      floor: 500,
      ceiling: 10000,
    },
    {
      vertical: 'grocery',
      zoneFares: [],
      tierFares: deliveryTierFares,
      defaultFare: 1500,
      components: [deliveryBase, serviceFee, shadowDistance, shadowTime, deliveryDoor, deliveryStreetHandover, wait, promo],
      floor: 500,
      ceiling: 15000,
    },
    {
      vertical: 'errand',
      zoneFares: [],
      tierFares: deliveryTierFares,
      defaultFare: 1500,
      components: [deliveryBase, serviceFee, shadowDistance, shadowTime, errandDoorPickup, deliveryStreetHandover, wait, promo],
      floor: 500,
      ceiling: 15000,
    },
    {
      vertical: 'parcel',
      zoneFares: [],
      tierFares: deliveryTierFares,
      defaultFare: 1500,
      components: [deliveryBase, serviceFee, shadowDistance, shadowTime, errandDoorPickup, deliveryStreetHandover, promo],
      floor: 500,
      ceiling: 15000,
    },
    {
      vertical: 'intercity',
      zoneFares: intercityFares,
      defaultFare: 5000,
      components: [rideBase, shadowDistance, shadowTime, frontSeat, rideDoorPickup, rideStreetPickup, promo],
      floor: 5000,
      ceiling: 40000,
    },
    {
      vertical: 'khat',
      zoneFares: [],
      tierFares: tuktukTierFares,
      defaultFare: 3000,
      components: [rideBase, shadowDistance, shadowTime, rideStreetPickup],
      floor: 2000,
      ceiling: 10000,
    },
  ],
  dispatch: {
    taxi: rides,
    tuktuk: rides,
    parcel: smartBroadcast,
    food: autoAssign,
    grocery: autoAssign,
    errand: autoAssign,
    intercity: scheduled,
    khat: preAssigned,
  },
  creditCapsIqd: { bronze: 75000, silver: 150000, gold: 300000 },
  // Launch: every merchant deal waits for platform approval (domain §11); flip to false to self-serve.
  merchantDeals: { requirePlatformApproval: true, maxPercent: 50, maxDays: 60 },
};
