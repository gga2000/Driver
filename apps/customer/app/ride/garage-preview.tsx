import { Redirect, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { GARAGE_TAXI_RULES, type GarageArmView, type GarageTaxiLink, type GarageTaxiPlace, type ToGaragePlan } from '@driver/contracts';
import { Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { ArmedRideCard, ArmedRideCardView } from '@/features/ride/ArmedRideCard';
import { BaghdadModeCard, BaghdadModeCardView } from '@/features/ride/BaghdadModeCard';
import type { BaghdadModeState, CarBack } from '@/features/ride/baghdad-mode';
import { GarageLateNotice, GarageLateNoticeView } from '@/features/ride/GarageLateNotice';
import { GarageTaxiCard, GarageTaxiCardView } from '@/features/ride/GarageTaxiCard';
import { hasView, type ArmCardState, type ToGarageCardState } from '@/features/ride/garage-taxi';
import { DEV_TOOLS } from '@/lib/env';

/**
 * Dev only (`EXPO_PUBLIC_DEV_TOOLS`): the الرجعة taxi cards (x2, x3, x4) in every state with sample
 * data, for review and the `SHOTS=rajaa-taxi` screenshots. With `?out=&ret=&armed=&placed=&late=`
 * (the ids `POST /demo/rajaa-taxi` returns) it also shows the live cards on the demo server's data.
 * Ride idea n9 «Baghdad mode» too: every state of its card, and with `?n9=1` the live card (it shows
 * only when the browser's position, already allowed, is in Baghdad or Kut).
 * Section labels are developer codes, not app copy. Not linked from anywhere in the app.
 */
export default function GaragePreviewPage() {
  if (!DEV_TOOLS) return <Redirect href="/" />;
  return <GaragePreview />;
}

const MIN = 60_000;
const NOW = Date.now();
const at = (min: number) => new Date(Math.ceil((NOW + min * MIN) / (5 * MIN)) * 5 * MIN);
const GARAGE = { id: 'mp_garage_bab1', nameAr: 'كراج البوابة 1', nameEn: 'Gate 1 garage' };
const PLACES: GarageTaxiPlace[] = [
  { id: 'pl_home', label: 'home', name: 'البيت', zoneName_ar: 'حي الشهداء' },
  { id: 'pl_work', label: 'work', name: 'الدائرة', zoneName_ar: 'المركز' },
];

const PLAN: ToGaragePlan = {
  bookingId: 'bk_demo',
  status: 'offer',
  unavailable: null,
  garage: GARAGE,
  departAt: at(95),
  places: PLACES,
  fromPlaceId: 'pl_home',
  fromName: 'البيت',
  mode: 'later',
  pickupAt: at(70),
  arriveAt: at(85),
  rideMin: 9,
  bufferMin: GARAGE_TAXI_RULES.bufferMin,
  fareIqd: 3000,
  totalIqd: 3000,
  paymentMethod: 'cash',
  order: null,
};

const ARM: GarageArmView = {
  bookingId: 'bk_back',
  status: 'off',
  unavailable: null,
  garage: { id: 'mp_garage_bab2', nameAr: 'كراج البوابة 2', nameEn: 'Gate 2 garage' },
  places: PLACES,
  toPlaceId: 'pl_home',
  toName: 'البيت',
  estimateIqd: 2500,
  paymentMethod: 'cash',
  carEtaMin: 38,
  placeAtEtaMin: GARAGE_TAXI_RULES.placeAtEtaMin,
  orderId: null,
  placedAt: null,
  failCode: null,
};

const LINK: GarageTaxiLink = { orderId: 'ord_demo', bookingId: 'bk_demo', garage: GARAGE, departAt: at(25), expectedAt: new Date(at(25).getTime() + 7 * MIN), lateMin: 7, driverTold: false, toldMin: null };

const X2: [string, ToGarageCardState][] = [
  ['offer-later', { kind: 'offer', plan: PLAN, offline: false }],
  ['offer-now', { kind: 'offer', plan: { ...PLAN, departAt: at(30), mode: 'now', pickupAt: null, arriveAt: at(18) }, offline: false }],
  ['offer-offline', { kind: 'offer', plan: PLAN, offline: true }],
  ['booked', { kind: 'booked', plan: { ...PLAN, status: 'booked', order: { orderId: 'ord_demo', state: 'placed', scheduledFor: at(70) } }, offline: false }],
  ['no-place', { kind: 'no_place', plan: { ...PLAN, status: 'unavailable', unavailable: 'no_place', places: [], fromPlaceId: null, fromName: null }, offline: false }],
  ['too-late', { kind: 'too_late', plan: { ...PLAN, status: 'unavailable', unavailable: 'too_late', departAt: at(5) }, offline: false }],
  ['loading', { kind: 'loading' }],
  ['error', { kind: 'error' }],
  ['offline', { kind: 'offline' }],
];

const X4: [string, ArmCardState][] = [
  ['off', { kind: 'off', view: ARM, offline: false }],
  ['armed', { kind: 'armed', view: { ...ARM, status: 'armed' }, offline: false }],
  ['placed', { kind: 'placed', view: { ...ARM, status: 'placed', orderId: 'ord_demo', placedAt: new Date(NOW) }, offline: false }],
  ['dropped', { kind: 'dropped', view: { ...ARM, status: 'dropped' }, offline: false }],
  ['failed', { kind: 'failed', view: { ...ARM, status: 'failed', failCode: 'new_customer_cash_cap' }, offline: false }],
  ['no-place', { kind: 'no_place', view: { ...ARM, status: 'unavailable', unavailable: 'no_place', places: [], toPlaceId: null, toName: null, estimateIqd: null }, offline: false }],
  ['loading', { kind: 'loading' }],
  ['error', { kind: 'error' }],
];

const X3: [string, GarageTaxiLink][] = [
  ['not-told', LINK],
  ['told', { ...LINK, driverTold: true, toldMin: 7 }],
];

const NAHDHA = 'كراج النهضة';
const CAR: CarBack = { departureId: 'dep_demo', corridorId: 'aziziyah_baghdad', garageNameAr: NAHDHA, departAt: at(35), free: 3, seatPriceIqd: 15000 };
const SEAT = { bookingId: 'bk_back', state: 'booked' as const, departAt: at(50), seatIds: ['back_right' as const], garageNameAr: NAHDHA, heldUntil: null };

/** 7:00 ص tomorrow on Baghdad's clock (UTC+3): the first car announced, for the empty card. */
const DAY = 24 * 60 * MIN;
const TOMORROW_7AM = new Date(Math.floor((NOW + 180 * MIN) / DAY) * DAY + DAY + 4 * 60 * MIN);

const N9: [string, BaghdadModeState][] = [
  ['next', { kind: 'next', cityId: 'baghdad', next: CAR, after: { ...CAR, departureId: 'dep_after', departAt: at(95), free: 2 }, offline: false }],
  ['next-last-seat', { kind: 'next', cityId: 'baghdad', next: { ...CAR, departAt: at(10), free: 1 }, after: null, offline: false }],
  ['next-offline', { kind: 'next', cityId: 'baghdad', next: CAR, after: { ...CAR, departureId: 'dep_after', departAt: at(95), free: 2 }, offline: true }],
  ['kut', { kind: 'next', cityId: 'kut', next: { ...CAR, corridorId: 'aziziyah_kut', garageNameAr: 'كراج الكوت', seatPriceIqd: 10000 }, after: null, offline: false }],
  ['empty-announced', { kind: 'empty', cityId: 'baghdad', corridorId: 'aziziyah_baghdad', announced: { ...CAR, departAt: TOMORROW_7AM }, offline: false }],
  ['empty', { kind: 'empty', cityId: 'baghdad', corridorId: 'aziziyah_baghdad', announced: null, offline: false }],
  ['booked', { kind: 'booked', cityId: 'baghdad', seat: SEAT, offline: false }],
  ['held', { kind: 'booked', cityId: 'baghdad', seat: { ...SEAT, state: 'held', heldUntil: at(8) }, offline: false }],
  ['loading', { kind: 'loading', cityId: 'baghdad' }],
  ['error', { kind: 'error', cityId: 'baghdad' }],
  ['offline', { kind: 'offline', cityId: 'baghdad' }],
];

const noop = () => undefined;

function Section({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View testID={id} style={{ gap: theme.space[2], paddingVertical: theme.space[2] }}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      {children}
    </View>
  );
}

function GaragePreview() {
  const theme = useTheme();
  const p = useLocalSearchParams<{ out?: string; ret?: string; armed?: string; placed?: string; late?: string; n9?: string }>();
  return (
    <Screen edges={['bottom']} testID="garage-preview">
      <View style={{ gap: theme.space[3] }}>
        {p.out ? (
          <Section id="pv-live-x2" label="live · x2">
            <GarageTaxiCard bookingId={p.out} testID="live-x2" />
          </Section>
        ) : null}
        {p.ret ? (
          <Section id="pv-live-x4" label="live · x4 off">
            <ArmedRideCard bookingId={p.ret} testID="live-x4" />
          </Section>
        ) : null}
        {p.armed ? (
          <Section id="pv-live-x4-armed" label="live · x4 armed">
            <ArmedRideCard bookingId={p.armed} testID="live-x4-armed" />
          </Section>
        ) : null}
        {p.placed ? (
          <Section id="pv-live-x4-placed" label="live · x4 placed">
            <ArmedRideCard bookingId={p.placed} testID="live-x4-placed" />
          </Section>
        ) : null}
        {p.n9 ? (
          <Section id="pv-live-n9" label="live · n9">
            <BaghdadModeCard testID="live-n9" />
          </Section>
        ) : null}
        {p.late ? (
          <Section id="pv-live-x3" label="live · x3">
            <GarageLateNotice orderId={p.late} testID="live-x3" />
          </Section>
        ) : null}
        {X2.map(([key, state]) => (
          <Section key={`x2-${key}`} id={`pv-x2-${key}`} label={`x2 · ${key}`}>
            <GarageTaxiCardView state={state} now={NOW} onPlace={noop} onBook={noop} onRetry={noop} onSeeRide={noop} onAddPlace={noop} testID={`x2-${key}`} />
          </Section>
        ))}
        {X3.map(([key, link]) => (
          <Section key={`x3-${key}`} id={`pv-x3-${key}`} label={`x3 · ${key}`}>
            <GarageLateNoticeView link={link} testID={`x3-${key}`} />
          </Section>
        ))}
        {X4.map(([key, state]) => (
          <Section key={`x4-${key}`} id={`pv-x4-${key}`} label={`x4 · ${key}`}>
            <ArmedRideCardView
              state={state}
              placeId={hasView(state) ? state.view.toPlaceId : null}
              onPlace={noop}
              onArm={noop}
              onDisarm={noop}
              onRetry={noop}
              onSeeTaxi={noop}
              onOrderSelf={noop}
              onAddPlace={noop}
              testID={`x4-${key}`}
            />
          </Section>
        ))}
        {N9.map(([key, state]) => (
          <Section key={`n9-${key}`} id={`pv-n9-${key}`} label={`n9 · ${key}`}>
            <BaghdadModeCardView
              state={state}
              now={NOW}
              onBook={noop}
              onSeeSeat={noop}
              onWantBack={noop}
              onRetry={noop}
              armed={() => <ArmedRideCardView state={{ kind: 'off', view: ARM, offline: false }} placeId={ARM.toPlaceId} onPlace={noop} onArm={noop} onDisarm={noop} onRetry={noop} onSeeTaxi={noop} onOrderSelf={noop} onAddPlace={noop} testID={`n9-${key}-armed`} />}
              testID={`n9-${key}`}
            />
          </Section>
        ))}
      </View>
    </Screen>
  );
}
