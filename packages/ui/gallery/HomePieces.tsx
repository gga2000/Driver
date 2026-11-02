import type { ReactNode } from 'react';
import { Image, View, type ImageSourcePropType } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Text, useTheme } from '../src';
import { CalmPanel, HomeMapCard, LiveBoard, OffersPanel, OrderPanel, PointsPill, RiverLine, riverFill, type HomeDish, type OrderStage } from '../src/home';
import mapDay from './assets/map-day.jpg';
import mapNight from './assets/map-night.jpg';
// The app's own cut-out pictures (apps/customer/assets/home), so the gallery shows the real ones.
import foodPic from '../../../apps/customer/assets/home/food.webp';
import taxiPic from '../../../apps/customer/assets/home/taxi.webp';
import tuktukPic from '../../../apps/customer/assets/home/tuktuk.webp';
import intercityPic from '../../../apps/customer/assets/home/intercity.webp';
import bamia from '../../../apps/customer/assets/home/dishes/bamia.webp';
import liver from '../../../apps/customer/assets/home/dishes/liver.webp';
import biryani from '../../../apps/customer/assets/home/dishes/biryani.webp';

const src = (s: number | string): ImageSourcePropType => (typeof s === 'string' ? { uri: s } : s);
const PICTURES = { food: src(foodPic), taxi: src(taxiPic), tuktuk: src(tuktukPic), intercity: src(intercityPic) };
const TOWN = 'العزيزية';
const DISHES: HomeDish[] = [
  { id: 'bamia', name: 'تمن ومرق بامية', restaurant: 'مطعم خالد', minutes: 15, price: 4000, was: 5000, picture: { source: src(bamia) } },
  { id: 'liver', name: 'لفة معلاق', restaurant: 'كبدة أبو حيدر', minutes: 18, price: 2500, was: 3000, picture: { source: src(liver) } },
  { id: 'biryani', name: 'برياني دجاج', restaurant: 'مطعم المسافر', minutes: 22, price: 10000, was: 12000, picture: { source: src(biryani) } },
];
const DEPARTURES = [
  { id: 'bgd', city: 'بغداد', time: '4:30', part: 'العصر', seats: 7, free: 3 },
  { id: 'kut', city: 'الكوت', time: '7:00', part: 'الصبح', seats: 7, free: 5 },
];

/** A map crop from the project's renders, tinted to the card style; the app draws the real map here. */
function MapStill({ order }: { order: boolean }) {
  const theme = useTheme();
  const night = theme.scheme === 'dark';
  const pin = night ? '#00E575' : '#1F3A2B';
  const ring = night ? '#09110D' : '#F1F4EF';
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <Image source={src(night ? mapNight : mapDay)} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
      <Svg width="100%" height="100%" viewBox="0 0 356 200" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', top: 0, left: 0 }}>
        {order ? (
          <>
            <Path d="M70 58 L132 92 L196 120 L262 150" stroke="#1A231C" strokeWidth={8} fill="none" strokeLinecap="round" opacity={0.25} />
            <Path d="M70 58 L132 92 L196 120 L262 150" stroke="#FF7A1F" strokeWidth={4.5} strokeDasharray="9 6" fill="none" strokeLinecap="round" />
            <Circle cx={70} cy={58} r={13} fill={pin} stroke={ring} strokeWidth={3} />
            <Circle cx={262} cy={150} r={13} fill="#1A231C" stroke="#F2FFF6" strokeWidth={3} />
            <Path d="M257 152 L262 146 L267 152 V157 H257Z" fill="#F2FFF6" />
            <Circle cx={160} cy={103} r={18} fill="#FF7A1F" stroke="#1A231C" strokeWidth={3} />
            <Circle cx={155} cy={107} r={3.5} fill="none" stroke="#160D05" strokeWidth={2} />
            <Circle cx={166} cy={107} r={3.5} fill="none" stroke="#160D05" strokeWidth={2} />
            <Path d="M155 107 L160 99 H165 L166 107" stroke="#160D05" strokeWidth={2} fill="none" />
          </>
        ) : (
          <>
            {[[60, 60], [150, 40], [250, 80], [300, 150], [110, 150], [200, 170]].map(([x, y]) => (
              <Circle key={`${x}-${y}`} cx={x} cy={y} r={7} fill={pin} stroke={ring} strokeWidth={2.5} />
            ))}
            <Rect x={220} y={122} width={14} height={9} rx={2} fill="#E3B23C" stroke="#1A231C" strokeWidth={1.5} />
            <Rect x={40} y={110} width={14} height={9} rx={2} fill="#E3B23C" stroke="#1A231C" strokeWidth={1.5} />
            <Rect x={170} y={70} width={12} height={9} rx={2} fill="#9FD36A" stroke="#1A231C" strokeWidth={1.5} />
            <Rect x={320} y={40} width={11} height={9} rx={2} fill="#E07A8E" stroke="#1A231C" strokeWidth={1.5} />
            <Circle cx={178} cy={118} r={13} fill="#1A231C" stroke="#F2FFF6" strokeWidth={3} />
            <Path d="M173 120 L178 114 L183 120 V125 H173Z" fill="#F2FFF6" />
          </>
        )}
      </Svg>
    </View>
  );
}

function Piece({ title, note, children, id }: { title: string; note?: string; children: ReactNode; id: string }) {
  const theme = useTheme();
  return (
    <View testID={id} nativeID={id} style={{ width: 390, padding: theme.space[4], gap: theme.space[2], backgroundColor: theme.colors.bg }}>
      <Text variant="footnote" weight={700} color="textMuted">
        {title}
      </Text>
      {note ? (
        <Text variant="footnote" color="textMuted">
          {note}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

const ORDER = { from: 'مطعم خالد', title: 'الدليفري طلع من المطعم', minutes: 12, cash: 19250, person: { name: 'حيدر', kind: 'courier' as const }, onMessage: () => {} };
const STAGE_TITLES: Record<OrderStage, string> = { placed: 'طلبك عند المطعم', preparing: 'دا يتحضّر', on_way: 'الدليفري طلع من المطعم', arrived: 'وصل طلبك، بالعافية' };

/** Step 3 of the home redesign: every piece in every state, in the theme the gallery wears. */
export function HomePiecesSection() {
  const theme = useTheme();
  return (
    <View testID="home-pieces" style={{ width: '100%', gap: theme.space[4], marginBottom: theme.space[8] }}>
      <Text variant="heading">قطع الواجهة الجديدة (الخطوة 3)</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[4], alignItems: 'flex-start' }}>
        <Piece id="hp-order" title="الخريطة + طلب بالطريق">
          <HomeMapCard map={<MapStill order />} town={TOWN} ageSec={8} route={{ from: 'مطعم خالد', to: 'البيت' }}>
            <OrderPanel {...ORDER} stage="on_way" />
          </HomeMapCard>
        </Piece>
        <Piece id="hp-offers" title="الخريطة + عروض (الغدا والعشا)">
          <HomeMapCard map={<MapStill order={false} />} town={TOWN}>
            <OffersPanel town={TOWN} meal="lunch" until="3" dishes={DISHES} />
          </HomeMapCard>
        </Piece>
        <Piece id="hp-calm" title="الخريطة + هادي (باقي اليوم)">
          <HomeMapCard map={<MapStill order={false} />} town={TOWN}>
            <CalmPanel town={TOWN} open={22} dish={DISHES[0]!} />
          </HomeMapCard>
        </Piece>
        <Piece id="hp-board" title="شنو تحتاج؟">
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, padding: 10, borderWidth: 1, borderColor: theme.colors.border }}>
            <LiveBoard town={TOWN} open={22} rideMinutes={3} departures={DEPARTURES} carts={3} pictures={PICTURES} />
          </View>
        </Piece>
        <Piece id="hp-board-quiet" title="شنو تحتاج؟ بالليل المتأخر" note="ماكو سيارة قريبة، ماكو رحلات باقية، العربانات مسدودة">
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, padding: 10, borderWidth: 1, borderColor: theme.colors.border }}>
            <LiveBoard town={TOWN} open={4} rideMinutes={null} departures={[]} carts={0} pictures={PICTURES} />
          </View>
        </Piece>
        {(['placed', 'preparing', 'arrived'] as const).map((stage) => (
          <Piece key={stage} id={`hp-stage-${stage}`} title={`مرحلة: ${STAGE_TITLES[stage]}`}>
            <HomeMapCard map={<MapStill order />} town={TOWN} ageSec={stage === 'placed' ? 2 : 40} route={{ from: 'مطعم خالد', to: 'البيت' }} mapHeight={120}>
              <OrderPanel {...ORDER} stage={stage} title={STAGE_TITLES[stage]} cash={stage === 'arrived' ? undefined : ORDER.cash} />
            </HomeMapCard>
          </Piece>
        ))}
        <Piece id="hp-ride" title="تكسي شغّال + التحديث قديم">
          <HomeMapCard map={<MapStill order />} town={TOWN} ageSec={260} route={{ from: 'السوق', to: 'البيت' }} mapHeight={120}>
            <OrderPanel from="تكسي · 4 ركاب" title="السايق جاي عليك" stage="on_way" minutes={4} person={{ name: 'عباس', kind: 'driver' }} onMessage={() => {}} />
          </HomeMapCard>
        </Piece>
        <Piece id="hp-bits" title="النقاط والنهر" note="النهر يتعبّى برتقالي ويه الطلب: طلبت · يتحضّر · بالطريق · وصل">
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="heading" face="display">
              درايفر
            </Text>
            <PointsPill points={120} />
          </View>
          <View style={{ flexDirection: 'row', gap: theme.space[6], height: 120, justifyContent: 'center' }}>
            {([null, 'placed', 'preparing', 'on_way', 'arrived'] as const).map((s) => (
              <RiverLine key={s ?? 'none'} fill={riverFill(s)} style={{ height: '100%' }} />
            ))}
          </View>
        </Piece>
      </View>
    </View>
  );
}
