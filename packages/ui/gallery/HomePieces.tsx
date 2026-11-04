import type { ReactNode } from 'react';
import { Image, ScrollView, View, type ImageSourcePropType } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Icon, TabBar, Text, useTheme } from '../src';
import { BigDishCard, CalmPanel, DishPair, DishPairSkeleton, HomeMapCardSkeleton, LiveBoardSkeleton, RestaurantRowSkeleton, CompactDish, HomeChips, HomeMapCard, RestaurantCard, LiveBoard, OffersPanel, OrderPanel, PointsPill, RiverLine, homeSize, riverFill, useHomeLook, type HomeDish, type OrderStage, type UsualOrder } from '../src/home';
import { t } from '@driver/i18n';
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
function MapStill({ order, ended }: { order: boolean; /** Cancelled: only the restaurant, no courier or route. */ ended?: boolean }) {
  const theme = useTheme();
  const night = theme.scheme === 'dark';
  const pin = night ? '#00E575' : '#1F3A2B';
  const ring = night ? '#09110D' : '#F1F4EF';
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <Image source={src(night ? mapNight : mapDay)} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
      <Svg width="100%" height="100%" viewBox="0 0 356 200" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', top: 0, left: 0 }}>
        {ended ? (
          <Circle cx={REST[0]} cy={REST[1]} r={11} fill={pin} stroke={ring} strokeWidth={3} />
        ) : order ? (
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
            {/* Idle: only the open restaurants, quiet, and home (audit round 3: no decoration squares). */}
            {IDLE_PINS.map(([x, y]) => (
              <Circle key={`${x}-${y}`} cx={x} cy={y} r={6} fill={pin} stroke={ring} strokeWidth={2.5} />
            ))}
            <Circle cx={178} cy={118} r={13} fill="#1A231C" stroke="#F2FFF6" strokeWidth={3} />
            <Path d="M173 120 L178 114 L183 120 V125 H173Z" fill="#F2FFF6" />
          </>
        )}
      </Svg>
      {order || ended ? null : <IdleLabels />}
    </View>
  );
}

const IDLE_PINS: readonly (readonly [number, number])[] = [[60, 70], [150, 52], [250, 84], [292, 140], [112, 146], [214, 160]];
/** The two open kitchens nearest home, named with their minutes («خالد · 12 د»); the app's map draws these. */
const IDLE_NAMED = [
  { at: [150, 52] as const, name: 'خالد', n: 12 },
  { at: [214, 160] as const, name: 'أبو حيدر', n: 9 },
];

function IdleLabels() {
  const look = useHomeLook();
  // The still is drawn with «slice» into a 358 × 156 card: one scale, cropped top and bottom.
  const k = 358 / 356;
  const top = (200 * k - homeSize.mapIdle) / 2;
  return (
    <>
      {IDLE_NAMED.map(({ at: [x, y], name, n }) => (
        <View
          key={name}
          style={{ position: 'absolute', left: x * k + 9, top: y * k - top - 11, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 22, borderRadius: 11, backgroundColor: look.card.fill, boxShadow: look.card.shadow ?? undefined }}
        >
          <Text variant="footnote" weight={600} compact>{name}</Text>
          <Text variant="footnote" color="textMuted" tabular compact>{t('live_map.min', { n })}</Text>
        </View>
      ))}
    </>
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

const USUAL: UsualOrder = { id: 'usual-hajji', restaurant: 'مطعم الحجي', items: 'تمن وقيمة ولبن', price: 4500, picture: { source: src(qeema) }, friday: false };
const PAIR: HomeDish[] = [
  { id: 'biryani', name: 'برياني دجاج للعائلة', restaurant: 'مطعم المسافر', minutes: 30, price: 12000, picture: { source: src(biryani) } },
  { id: 'bamia', name: 'تمن ومرق بامية', restaurant: 'مطعم خالد', minutes: 15, price: 4000, picture: { source: src(bamia) } },
];
const ORDER = { from: 'مطعم خالد', title: 'طلع من المطعم', minutes: 12, cash: 19250, person: { name: 'حيدر', kind: 'courier' as const }, onMessage: () => {} };
const STAGE_TITLES: Record<OrderStage, string> = { placed: 'طلبك عند المطعم', preparing: 'دا يتحضّر', on_way: 'طلع من المطعم', arrived: 'وصل طلبك، بالعافية', cancelled: 'انلغى الطلب من طرفنا' };

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
          <HomeMapCard map={<MapStill order={false} />} town={TOWN} mapHeight={homeSize.mapIdle}>
            <CalmPanel dish={DISHES[0]!} />
          </HomeMapCard>
        </Piece>
        <Piece id="hp-usual" title="الخريطة + طلبك المعتاد (زبون دايمي)" note="اللوحة نفسها تصير طلبه المعتاد: الأكل ينعرض مرة وحدة">
          <HomeMapCard map={<MapStill order={false} />} town={TOWN} mapHeight={homeSize.mapIdle}>
            <CalmPanel usual={USUAL} onReorder={() => {}} />
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
            <OrderPanel {...ORDER} title="طلع من المطعم" stage="on_way" minutes={9} notice={{ tone: 'late', title: t('home.panel.late_title'), time: '1:40 الظهر', text: 'إذا تأخرنا بعد 1:40 ترجعلك أجرة التوصيل' }} />
          </HomeMapCard>
        </Piece>
        <Piece id="hp-cancelled" title="انلغى الطلب">
          <HomeMapCard map={<MapStill order ended />} frozen town={TOWN} mapHeight={120}>
            <OrderPanel
              from="مطعم خالد"
              title={STAGE_TITLES.cancelled}
              stage="cancelled"
              notice={{ tone: 'ended', title: 'المطعم سدّ قبل لا يحضّر طلبك. نعتذر منك', text: 'ما دفعت شي: الطلب كان كاش عند الباب' }}
              actions={{ primary: { label: t('home.panel.cancel_browse'), onPress: () => {} }, secondary: { label: t('home.panel.cancel_help'), onPress: () => {} } }}
            />
          </HomeMapCard>
        </Piece>
        <Piece id="hp-offline" title="ماكو انترنت">
          <HomeMapCard map={<MapStill order />} town={TOWN} updatedAt={NOW - 240_000} now={NOW} offline route={{ from: 'مطعم خالد', to: 'البيت' }} mapHeight={120}>
            <OrderPanel {...ORDER} title="طلع من المطعم" stage="on_way" offline />
          </HomeMapCard>
        </Piece>
        <Piece id="hp-loading" title="دا يتحمّل">
          <HomeMapCardSkeleton mapHeight={120} />
          <LiveBoardSkeleton />
          <DishPairSkeleton />
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
        <Piece id="hp-pair" title="أكلتين لهالوقت (بدون طلب)">
          <DishPair dishes={PAIR} onAdd={() => {}} />
          <DishPair dishes={[{ id: 'qeema', name: 'تمن وقيمة', restaurant: 'مطعم الحجي', minutes: 20, price: 4500, picture: { source: src(qeema) } }, { id: 'kabab', name: 'كباب عروگ مشوي على الفحم ويه خبز تنور', restaurant: 'مشويات الشط', minutes: 25, price: 7500 }]} onAdd={() => {}} />
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
          <Text variant="heading" face="display">{order ? t('home.order_headline') : 'شنو غدانا اليوم؟'}</Text>
          <View>
            {order ? <RiverLine fill={riverFill('on_way')} style={{ position: 'absolute', top: 20, bottom: 20, end: -10 }} /> : null}
            {order ? (
              <HomeMapCard map={<MapStill order />} town={TOWN} updatedAt={NOW - 8000} now={NOW} route={{ from: 'مطعم خالد', to: 'البيت' }}>
                <OrderPanel {...ORDER} title="طلع من المطعم" stage="on_way" />
              </HomeMapCard>
            ) : (
              <HomeMapCard map={<MapStill order={false} />} town={TOWN} updatedAt={NOW - 20_000} now={NOW}>
                <CalmPanel usual={USUAL} onReorder={() => {}} />
              </HomeMapCard>
            )}
          </View>
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
          <View style={{ gap: theme.space[3] }}>
            <Text variant="title" face="display">للغدا اليوم</Text>
            <DishPair dishes={PAIR} onAdd={() => {}} />
          </View>
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
