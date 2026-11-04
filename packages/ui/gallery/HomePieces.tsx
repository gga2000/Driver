import type { ReactNode } from 'react';
import { Image, ScrollView, View, type ImageSourcePropType } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Icon, TabBar, Text, useTheme } from '../src';
import { BigDishCard, CalmPanel, HomeMapCardSkeleton, LiveBoardSkeleton, RestaurantRowSkeleton, CompactDish, HomeChips, HomeMapCard, RestaurantCard, UsualCard, LiveBoard, OffersPanel, OrderPanel, PointsPill, RiverLine, riverFill, useHomeLook, type HomeDish, type OrderStage } from '../src/home';
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
import qeema from '../../../apps/customer/assets/home/dishes/qeema.webp';

const src = (s: number | string): ImageSourcePropType => (typeof s === 'string' ? { uri: s } : s);
const PICTURES = { food: src(foodPic), taxi: src(taxiPic), tuktuk: src(tuktukPic), intercity: src(intercityPic) };
const NOW = Date.UTC(2026, 10, 4, 9, 0);
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

// The route along the crop's real streets: down the side street, east on the main road, then down the avenue.
const REST = [203, 48] as const;
const RIDER = [213, 112] as const;
const HOME = [200, 160] as const;
const DRIVEN = `M${REST[0]} ${REST[1]} L193 68 L177 104 L${RIDER[0]} ${RIDER[1]}`;
const AHEAD = `M${RIDER[0]} ${RIDER[1]} L246 124 L232 137 L${HOME[0]} ${HOME[1]}`;
/** Small arrows the way the courier drives: [x, y, angle in degrees]. */
const ARROWS: readonly (readonly [number, number, number])[] = [
  [230, 118, 20],
  [237, 133, 137],
  [216, 148, 137],
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
            {/* Look B from the route-lines work (#380): the line follows the streets, on the ground. */}
            <Path d={DRIVEN} stroke={night ? '#5E7468' : '#8A968C'} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
            <Path d={AHEAD} stroke={night ? '#09110D' : '#1A231C'} strokeWidth={8} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
            <Path d={AHEAD} stroke="#FF7A1F" strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            {ARROWS.map(([x, y, a]) => (
              <Path key={`${x}-${y}`} d="M-1.4 -1.7 L1.2 0 L-1.4 1.7" stroke="#160D05" strokeWidth={1.2} fill="none" strokeLinecap="round" strokeLinejoin="round" transform={`translate(${x} ${y}) rotate(${a})`} />
            ))}
            <Circle cx={REST[0]} cy={REST[1]} r={11} fill={pin} stroke={ring} strokeWidth={3} />
            <Circle cx={HOME[0]} cy={HOME[1]} r={11} fill="#1A231C" stroke="#F2FFF6" strokeWidth={3} />
            <Path d={`M${HOME[0] - 4.5} ${HOME[1] + 1.5} L${HOME[0]} ${HOME[1] - 4} L${HOME[0] + 4.5} ${HOME[1] + 1.5} V${HOME[1] + 5.5} H${HOME[0] - 4.5}Z`} fill="#F2FFF6" />
            <Circle cx={RIDER[0]} cy={RIDER[1]} r={15} fill="#FF7A1F" stroke="#1A231C" strokeWidth={3} />
            <Circle cx={RIDER[0] - 4.5} cy={RIDER[1] + 3} r={3} fill="none" stroke="#160D05" strokeWidth={1.8} />
            <Circle cx={RIDER[0] + 4.5} cy={RIDER[1] + 3} r={3} fill="none" stroke="#160D05" strokeWidth={1.8} />
            <Path d={`M${RIDER[0] - 4.5} ${RIDER[1] + 3} L${RIDER[0]} ${RIDER[1] - 3.5} H${RIDER[0] + 4} L${RIDER[0] + 4.5} ${RIDER[1] + 3}`} stroke="#160D05" strokeWidth={1.8} fill="none" />
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

const CHIPS = [
  { id: 'grill', label: 'مشاوي' },
  { id: 'family', label: 'للعائلة' },
  { id: 'shawarma', label: 'شاورما' },
  { id: 'falafel', label: 'فلافل' },
  { id: 'sweets', label: 'حلويات' },
];

const ORDER = { from: 'مطعم خالد', title: 'الدليفري طلع من المطعم', minutes: 12, cash: 19250, person: { name: 'حيدر', kind: 'courier' as const }, onMessage: () => {} };
const STAGE_TITLES: Record<OrderStage, string> = { placed: 'طلبك عند المطعم', preparing: 'دا يتحضّر', on_way: 'الدليفري طلع من المطعم', arrived: 'وصل طلبك، بالعافية', cancelled: 'انلغى الطلب من طرفنا' };

/** Step 3 of the home redesign: every piece in every state, in the theme the gallery wears. */
export function HomePiecesSection() {
  const theme = useTheme();
  return (
    <View testID="home-pieces" style={{ width: '100%', gap: theme.space[4], marginBottom: theme.space[8] }}>
      <Text variant="heading">قطع الواجهة الجديدة (الخطوة 3)</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[4], alignItems: 'flex-start' }}>
        <Piece id="hp-order" title="الخريطة + طلب بالطريق">
          <HomeMapCard map={<MapStill order />} town={TOWN} updatedAt={NOW - (8) * 1000} now={NOW} route={{ from: 'مطعم خالد', to: 'البيت' }}>
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
            <CalmPanel dish={DISHES[0]!} />
          </HomeMapCard>
        </Piece>
        <Piece id="hp-board" title="شنو تحتاج؟">
          <LiveBoard town={TOWN} open={22} rideMinutes={3} departures={DEPARTURES} carts={3} pictures={PICTURES} />
        </Piece>
        <Piece id="hp-board-quiet" title="شنو تحتاج؟ بالليل المتأخر" note="ماكو سيارة قريبة، ماكو رحلات باقية، العربانات مسدودة">
          <LiveBoard town={TOWN} open={4} rideMinutes={null} departures={[]} carts={0} pictures={PICTURES} />
        </Piece>
        {(['placed', 'preparing', 'arrived'] as const).map((stage) => (
          <Piece key={stage} id={`hp-stage-${stage}`} title={`مرحلة: ${STAGE_TITLES[stage]}`}>
            <HomeMapCard map={<MapStill order />} town={TOWN} updatedAt={NOW - (stage === 'placed' ? 2 : 40) * 1000} now={NOW} route={{ from: 'مطعم خالد', to: 'البيت' }} mapHeight={120}>
              <OrderPanel {...ORDER} stage={stage} title={STAGE_TITLES[stage]} cash={stage === 'arrived' ? undefined : ORDER.cash} />
            </HomeMapCard>
          </Piece>
        ))}
        <Piece id="hp-late" title="متأخر: اعتذار ووقت جديد" note="الجملة تجي من وعد التأخير بالتطبيق">
          <HomeMapCard map={<MapStill order />} town={TOWN} updatedAt={NOW - 6000} now={NOW} route={{ from: 'مطعم خالد', to: 'البيت' }} mapHeight={120}>
            <OrderPanel {...ORDER} stage="on_way" minutes={9} notice={{ tone: 'late', text: 'تأخرنا عليك، نعتذر. الوقت الجديد 1:40، وإذا تأخرنا بعد ترجعلك أجرة التوصيل' }} />
          </HomeMapCard>
        </Piece>
        <Piece id="hp-cancelled" title="انلغى الطلب">
          <HomeMapCard map={<MapStill order={false} />} town={TOWN} mapHeight={120}>
            <OrderPanel from="مطعم خالد" title={STAGE_TITLES.cancelled} stage="cancelled" notice={{ tone: 'ended', text: 'نعتذر منك. أي مبلغ دفعته يرجعلك' }} />
          </HomeMapCard>
        </Piece>
        <Piece id="hp-offline" title="ماكو انترنت">
          <HomeMapCard map={<MapStill order />} town={TOWN} updatedAt={NOW - 240_000} now={NOW} offline route={{ from: 'مطعم خالد', to: 'البيت' }} mapHeight={120}>
            <OrderPanel {...ORDER} stage="on_way" />
          </HomeMapCard>
        </Piece>
        <Piece id="hp-loading" title="دا يتحمّل">
          <HomeMapCardSkeleton mapHeight={120} />
          <LiveBoardSkeleton />
          <RestaurantRowSkeleton />
        </Piece>
        <Piece id="hp-ride" title="تكسي شغّال + التحديث قديم">
          <HomeMapCard map={<MapStill order />} town={TOWN} updatedAt={NOW - (260) * 1000} now={NOW} route={{ from: 'السوق', to: 'البيت' }} mapHeight={120}>
            <OrderPanel from="تكسي · 4 ركاب" title="السايق جاي عليك" stage="on_way" minutes={4} person={{ name: 'عباس', kind: 'driver' }} onMessage={() => {}} />
          </HomeMapCard>
        </Piece>
        <Piece id="hp-dish" title="أكلة اليوم (بدون طلب)">
          <BigDishCard dish={{ id: 'biryani', name: 'برياني دجاج للعائلة', restaurant: 'مطعم المسافر', minutes: 30, price: 12000, picture: { source: src(biryani) } }} tag="للعشا" onAdd={() => {}} />
        </Piece>
        <Piece id="hp-dish-nophoto" title="أكلة بدون صورة + اسم طويل" note="إذا ماكو صورة نرسم الأكلة نفسها">
          <BigDishCard dish={{ id: 'kabab', name: 'كباب عروگ مشوي على الفحم ويه خبز تنور وبصل', restaurant: 'مشويات الشط', minutes: 25, price: 7500 }} tag="للغدا اليوم" onAdd={() => {}} />
        </Piece>
        <Piece id="hp-compact" title="أكلة صغيرة (وقت الطلب)">
          <Text variant="bodyStrong" face="display">للغدا اليوم</Text>
          <CompactDish dish={{ id: 'qeema', name: 'تمن وقيمة', restaurant: 'مطعم الحجي', minutes: 20, price: 4500, picture: { source: src(qeema) } }} onAdd={() => {}} />
          <CompactDish dish={{ id: 'falafel', name: 'لفة فلافل', restaurant: 'فلافل أبو علي', minutes: 10, price: 1000 }} onAdd={() => {}} />
        </Piece>
        <Piece id="hp-usual" title="طلبك المعتاد (يوم عادي وجمعة)">
          <UsualCard restaurant="مطعم الحجي" items="تمن وقيمة · لبن" price={4500} picture={{ source: src(qeema) }} friday={false} onReorder={() => {}} />
          <UsualCard restaurant="مطعم خالد" items="تمن ومرق بامية ×2 · سلطة" price={9000} picture={{ source: src(bamia) }} friday onReorder={() => {}} />
        </Piece>
        <Piece id="hp-open" title="مفتوح هسة: الأصناف والمطاعم" note="ولا صنف مختار بالبداية؛ تحت: «للعائلة» مختار">
          <HomeChips chips={CHIPS} selected={null} onSelect={() => {}} />
          <HomeChips chips={CHIPS} selected="family" onSelect={() => {}} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[3] }}>
            <RestaurantCard name="مطعم خالد للمشويات والكص" rating={4.7} minutes={25} fee={1500} picture={{ source: src(liver) }} />
            <RestaurantCard name="فلافل أبو علي" rating={4.5} minutes={12} fee={0} />
          </ScrollView>
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

const TABS = [
  { name: 'index', label: 'الرئيسية', icon: 'home' as const },
  { name: 'orders', label: 'طلباتي', icon: 'receipt' as const },
  { name: 'wallet', label: 'المحفظة', icon: 'wallet' as const },
  { name: 'account', label: 'حسابي', icon: 'user' as const },
];

/** The whole home put together from the pieces (§12.2 order), for the audit — not the app's screen yet. */
function HomeScreenPreview({ order }: { order: boolean }) {
  const theme = useTheme();
  const look = useHomeLook();
  const section = theme.space[6];
  return (
    <View style={{ width: 390, backgroundColor: theme.colors.bg, overflow: 'hidden' }}>
      <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[4], gap: section }}>
        {/* Header: wordmark, where it goes, points; search right under it (audit round 2). */}
        <View style={{ gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <Text variant="heading" face="display">درايفر</Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: theme.hitTarget }}>
              <Text variant="label" color="textMuted" compact>نوصلك:</Text>
              <Text variant="label" weight={700} compact numberOfLines={1}>البيت</Text>
              <Icon name="chevron-down" size={16} color="textMuted" />
            </View>
            <PointsPill points={120} />
          </View>
          <View style={{ minHeight: 48, borderRadius: theme.radius.pill, backgroundColor: look.card.fill, boxShadow: look.card.shadow ?? undefined, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: theme.space[4] }}>
            <Icon name="search" size={20} color="textMuted" />
            <Text variant="body" color="textMuted">دور على مطعم أو أكلة</Text>
          </View>
        </View>
        <View style={{ gap: theme.space[3] }}>
          {order ? null : <Text variant="heading" face="display">شنو غدانا اليوم؟</Text>}
          <View>
            {order ? <RiverLine fill={riverFill('on_way')} style={{ position: 'absolute', top: 16, bottom: 16, end: -10 }} /> : null}
            {order ? (
              <HomeMapCard map={<MapStill order />} town={TOWN} updatedAt={NOW - 8000} now={NOW} route={{ from: 'مطعم خالد', to: 'البيت' }}>
                <OrderPanel {...ORDER} title="طلع من المطعم" stage="on_way" />
              </HomeMapCard>
            ) : (
              <HomeMapCard map={<MapStill order={false} />} town={TOWN}>
                <CalmPanel dish={DISHES[0]!} />
              </HomeMapCard>
            )}
          </View>
          {order ? null : <UsualCard restaurant="مطعم الحجي" items="تمن وقيمة · لبن" price={4500} picture={{ source: src(qeema) }} friday={false} onReorder={() => {}} />}
        </View>
        <View style={{ gap: theme.space[3] }}>
          <Text variant="title" face="display">شنو تحتاج؟</Text>
          <LiveBoard town={TOWN} open={22} rideMinutes={3} departures={DEPARTURES} carts={3} pictures={PICTURES} />
        </View>
        {order ? (
          <View style={{ gap: theme.space[3] }}>
            <Text variant="title" face="display">للغدا اليوم</Text>
            <CompactDish dish={{ id: 'qeema', name: 'تمن وقيمة', restaurant: 'مطعم الحجي', minutes: 20, price: 4500, picture: { source: src(qeema) } }} onAdd={() => {}} />
          </View>
        ) : (
          <BigDishCard dish={{ id: 'biryani', name: 'برياني دجاج للعائلة', restaurant: 'مطعم المسافر', minutes: 30, price: 12000, picture: { source: src(biryani) } }} tag="للغدا" onAdd={() => {}} />
        )}
        <View style={{ gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="title" face="display">مفتوح هسة</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: theme.hitTarget }}>
              <Text variant="label" weight={600} color="accentText" compact>كل المحلات</Text>
              <Icon name="chevron-forward" size={16} color="accentText" />
            </View>
          </View>
          <HomeChips chips={CHIPS} selected={null} onSelect={() => {}} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -theme.space[4] }} contentContainerStyle={{ gap: theme.space[3], paddingHorizontal: theme.space[4], paddingVertical: 6 }}>
            <RestaurantCard name="مطعم خالد" rating={4.7} minutes={25} fee={1500} picture={{ source: src(liver) }} />
            <RestaurantCard name="فلافل أبو علي" rating={4.5} minutes={12} fee={0} />
          </ScrollView>
        </View>
      </View>
      <View style={{ marginTop: theme.space[5] }}>
        <TabBar
          tabs={TABS}
          state={{ index: 0, routes: TABS.map((t) => ({ key: t.name, name: t.name })) }}
          navigation={{ emit: () => ({ defaultPrevented: false }), navigate: () => {} }}
        />
      </View>
    </View>
  );
}

/** Both whole screens side by side for the audit. */
export function HomeScreensSection() {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space[4], alignItems: 'flex-start', marginBottom: theme.space[8] }}>
      <View testID="hp-screen-idle"><HomeScreenPreview order={false} /></View>
      <View testID="hp-screen-order"><HomeScreenPreview order /></View>
    </View>
  );
}
