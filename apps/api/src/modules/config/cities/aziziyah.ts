import type { CityPricingConfig, ComponentRule, ZoneFare } from '@driver/contracts';

/**
 * Aziziyah (العزيزية), Wasit — launch city. All amounts are IQD integers.
 * Zone fares are symmetric: one row per pair covers both directions.
 */

const zones = [
  { id: 'center', name_ar: 'المركز', name_en: 'Center' },
  { id: 'north', name_ar: 'الشمالي', name_en: 'North' },
  { id: 'south', name_ar: 'الجنوبي', name_en: 'South' },
  { id: 'east', name_ar: 'الشرقي', name_en: 'East' },
  { id: 'west', name_ar: 'الغربي', name_en: 'West' },
  { id: 'outskirts', name_ar: 'الأطراف', name_en: 'Outskirts' },
  // Intercity destinations
  { id: 'kut', name_ar: 'الكوت', name_en: 'Kut' },
  { id: 'baghdad', name_ar: 'بغداد', name_en: 'Baghdad' },
];

const cityZoneFares: ZoneFare[] = [
  { from: 'center', to: 'center', fare: 3000 },
  { from: 'center', to: 'north', fare: 4000 },
  { from: 'center', to: 'south', fare: 4000 },
  { from: 'center', to: 'east', fare: 4000 },
  { from: 'center', to: 'west', fare: 4000 },
  { from: 'center', to: 'outskirts', fare: 5000 },
  { from: 'north', to: 'north', fare: 3000 },
  { from: 'north', to: 'south', fare: 5000 },
  { from: 'north', to: 'east', fare: 4000 },
  { from: 'north', to: 'west', fare: 4000 },
  { from: 'north', to: 'outskirts', fare: 5000 },
  { from: 'south', to: 'south', fare: 3000 },
  { from: 'south', to: 'east', fare: 4000 },
  { from: 'south', to: 'west', fare: 4000 },
  { from: 'south', to: 'outskirts', fare: 5000 },
  { from: 'east', to: 'east', fare: 3000 },
  { from: 'east', to: 'west', fare: 5000 },
  { from: 'east', to: 'outskirts', fare: 5000 },
  { from: 'west', to: 'west', fare: 3000 },
  { from: 'west', to: 'outskirts', fare: 5000 },
  { from: 'outskirts', to: 'outskirts', fare: 4000 },
];

const intercityFares: ZoneFare[] = [
  { from: 'center', to: 'kut', fare: 10000 },
  { from: 'north', to: 'kut', fare: 10000 },
  { from: 'south', to: 'kut', fare: 10000 },
  { from: 'east', to: 'kut', fare: 10000 },
  { from: 'west', to: 'kut', fare: 10000 },
  { from: 'outskirts', to: 'kut', fare: 10000 },
  { from: 'center', to: 'baghdad', fare: 15000 },
  { from: 'north', to: 'baghdad', fare: 15000 },
  { from: 'south', to: 'baghdad', fare: 15000 },
  { from: 'east', to: 'baghdad', fare: 15000 },
  { from: 'west', to: 'baghdad', fare: 15000 },
  { from: 'outskirts', to: 'baghdad', fare: 15000 },
  { from: 'kut', to: 'baghdad', fare: 15000 },
];

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
const base: ComponentRule = {
  key: 'base',
  label_ar: 'السعر الأساسي',
  label_en: 'Base fare',
  driverShareRule: 'driver_commissioned',
  visibility: 'shown',
};
const doorPickup: ComponentRule = {
  key: 'door_pickup',
  label_ar: 'نجيك للباب',
  label_en: 'Door pickup',
  driverShareRule: 'driver_full',
  visibility: 'shown',
  amount: 1000,
};
const streetPickup: ComponentRule = {
  key: 'street_pickup',
  label_ar: 'تلاقينا بالشارع',
  label_en: 'Street pickup',
  driverShareRule: 'driver_full',
  visibility: 'shown',
  amount: 0,
};
const wait: ComponentRule = {
  key: 'wait',
  label_ar: 'انتظار',
  label_en: 'Waiting',
  driverShareRule: 'driver_full',
  visibility: 'shown',
  perUnit: 250, // IQD per minute
};
const night: ComponentRule = {
  key: 'night',
  label_ar: 'رسوم الليل',
  label_en: 'Night fee',
  driverShareRule: 'driver_full',
  visibility: 'shown',
  amount: 1000,
  hours: [23, 5],
};
const promo: ComponentRule = {
  key: 'promo',
  label_ar: 'خصم',
  label_en: 'Discount',
  driverShareRule: 'platform_only',
  visibility: 'shown',
};

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
      zoneFares: cityZoneFares,
      defaultFare: 5000,
      components: [base, shadowDistance, shadowTime, doorPickup, streetPickup, wait, night, promo],
      floor: 3000,
      ceiling: 25000,
    },
    {
      vertical: 'tuktuk',
      zoneFares: cityZoneFares.map((z) => ({ ...z, fare: Math.max(2000, z.fare - 1000) })),
      defaultFare: 4000,
      components: [base, shadowDistance, shadowTime, doorPickup, streetPickup, wait, night, promo],
      floor: 2000,
      ceiling: 15000,
    },
    {
      vertical: 'food',
      // Delivery fee by merchant zone → customer zone.
      zoneFares: cityZoneFares.map((z) => ({ ...z, fare: z.fare === 3000 ? 2000 : z.fare === 4000 ? 3000 : 4000 })),
      defaultFare: 4000,
      components: [base, shadowDistance, shadowTime, doorPickup, streetPickup, night, promo],
      floor: 2000,
      ceiling: 10000,
    },
    {
      vertical: 'grocery',
      zoneFares: cityZoneFares.map((z) => ({ ...z, fare: z.fare === 3000 ? 2000 : z.fare === 4000 ? 3000 : 4000 })),
      defaultFare: 4000,
      components: [base, shadowDistance, shadowTime, doorPickup, streetPickup, wait, promo],
      floor: 2000,
      ceiling: 15000,
    },
    {
      vertical: 'intercity',
      zoneFares: intercityFares,
      defaultFare: 15000,
      components: [
        base,
        shadowDistance,
        shadowTime,
        {
          key: 'front_seat',
          label_ar: 'مقعد أمامي',
          label_en: 'Front seat',
          driverShareRule: 'driver_full',
          visibility: 'shown',
          amount: 2000,
        },
        doorPickup,
        streetPickup,
        promo,
      ],
      floor: 10000,
      ceiling: 40000,
    },
    {
      vertical: 'khat',
      zoneFares: cityZoneFares,
      defaultFare: 3000,
      components: [base, shadowDistance, shadowTime, streetPickup],
      floor: 2000,
      ceiling: 10000,
    },
  ],
  dispatch: {
    taxi: {
      policy: 'smart_broadcast',
      waves: [
        { size: 3, seconds: 15 },
        { size: 5, seconds: 15 },
        { size: 'all', seconds: 30 },
      ],
      maxBatch: 1,
      acceptTimeoutSec: 15,
      suggestOnly: false,
    },
    tuktuk: {
      policy: 'smart_broadcast',
      waves: [
        { size: 3, seconds: 15 },
        { size: 5, seconds: 15 },
        { size: 'all', seconds: 30 },
      ],
      maxBatch: 1,
      acceptTimeoutSec: 15,
      suggestOnly: false,
    },
    food: { policy: 'auto_assign', maxBatch: 2, acceptTimeoutSec: 20, suggestOnly: false },
    grocery: { policy: 'auto_assign', maxBatch: 2, acceptTimeoutSec: 20, suggestOnly: false },
    intercity: { policy: 'scheduled', maxBatch: 1, acceptTimeoutSec: 60, suggestOnly: false },
    khat: { policy: 'pre_assigned', maxBatch: 1, acceptTimeoutSec: 60, suggestOnly: false },
  },
  driverCreditCapIqd: 100000,
};
