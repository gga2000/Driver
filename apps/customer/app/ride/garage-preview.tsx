import { Redirect, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { GARAGE_TAXI_RULES, type GarageArmView, type GarageTaxiLink, type GarageTaxiPlace, type ToGaragePlan } from '@driver/contracts';
import { Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { ArmedRideCard, ArmedRideCardView } from '@/features/ride/ArmedRideCard';
import { GarageLateNotice, GarageLateNoticeView } from '@/features/ride/GarageLateNotice';
import { GarageTaxiCard, GarageTaxiCardView } from '@/features/ride/GarageTaxiCard';
import { hasView, type ArmCardState, type ToGarageCardState } from '@/features/ride/garage-taxi';
import { DEV_TOOLS } from '@/lib/env';

/**
 * Dev only (`EXPO_PUBLIC_DEV_TOOLS`): the الرجعة taxi cards (x2, x3, x4) in every state with sample
 * data, for review and the `SHOTS=rajaa-taxi` screenshots. With `?out=&ret=&armed=&placed=&late=`
 * (the ids `POST /demo/rajaa-taxi` returns) it also shows the live cards on the demo server's data.
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
  const p = useLocalSearchParams<{ out?: string; ret?: string; armed?: string; placed?: string; late?: string }>();
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
      </View>
    </Screen>
  );
}
