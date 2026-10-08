import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { SAFETY_RULES } from '@driver/contracts';
import { contrastRatio, type ThemeColorKey } from '@driver/design-tokens';
import { t } from '@driver/i18n';
import {
  OfflineBanner,
  OtpInput,
  Toggle,
  Avatar,
  Badge,
  Button,
  Card,
  ChipGroup,
  CountdownButton,
  CountdownRing,
  HoldButton,
  DepartureTime,
  EmptyState,
  formatAmount,
  formatIqd,
  ltr,
  Icon,
  ICON_NAMES,
  IconButton,
  ListRow,
  ModalSheet,
  PriceBreakdown,
  QueryBoundary,
  SearchField,
  SeatLegend,
  SeatMap,
  SegmentRing,
  SegmentedControl,
  Sheet,
  SosButton,
  SosSheet,
  Skeleton,
  SlideToConfirm,
  StatusPill,
  Stepper,
  Text,
  TextField,
  ThemeProvider,
  Timeline,
  Toast,
  ToastProvider,
  useTheme,
  useToast,
  VoiceNotePlayer,
  VoiceRecorderBar,
  MicHoldButton,
  type PriceItem,
  type QueryLike,
  type SeatId,
  type SeatInfo,
  type TimelineStep,
} from '../src';
import { SketchbookDishes, SketchbookPage, SketchbookScenes } from './Sketchbook';
import { StickersPage } from './Stickers';

/* ───────────────────────── layout helpers ───────────────────────── */

function Section({ title, note, children, wide }: { title: string; note?: string; children: ReactNode; wide?: boolean }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const twoCol = width >= 980;
  return (
    <View style={{ width: twoCol && !wide ? '50%' : '100%', paddingHorizontal: twoCol ? theme.space[3] : 0, marginBottom: theme.space[8] }}>
      <View style={{ marginBottom: theme.space[3], gap: 2 }}>
        <Text variant="heading">{title}</Text>
        {note ? (
          <Text variant="footnote" color="textMuted" style={{ maxWidth: 520 }}>
            {note}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Panel({ children, gap = 4, row, pad = 5 }: { children: ReactNode; gap?: 0 | 2 | 3 | 4 | 5 | 6; row?: boolean; pad?: 4 | 5 }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.xl,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: theme.space[pad],
        gap: theme.space[gap],
        flexDirection: row ? 'row' : 'column',
        flexWrap: row ? 'wrap' : 'nowrap',
        alignItems: row ? 'center' : 'stretch',
      }}
    >
      {children}
    </View>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return (
    <Text variant="caption" color="textMuted">
      {children}
    </Text>
  );
}

/* ───────────────────────── hero + palette ───────────────────────── */

const SWATCHES: { key: ThemeColorKey; name: string; on: ThemeColorKey; role: string }[] = [
  { key: 'bg', name: 'الخلفية', on: 'text', role: 'كريمي، ورق الشاشة' },
  { key: 'surface', name: 'السطح', on: 'textMuted', role: 'البطاقات والشيت' },
  { key: 'accent', name: 'البرتقالي', on: 'onAccent', role: 'الزر الرئيسي والمقعد الأمامي' },
  { key: 'accentTint', name: 'برتقالي فاتح', on: 'accentText', role: 'الاختيار والتمييز' },
  { key: 'text', name: 'الحبر', on: 'bg', role: 'النص' },
  { key: 'successTint', name: 'تمام', on: 'successText', role: 'وصل، متحقق، خصم' },
  { key: 'warningTint', name: 'انتباه', on: 'warningText', role: 'تأخير، حجز مؤقت' },
  { key: 'dangerTint', name: 'خطر', on: 'dangerText', role: 'خطأ، إلغاء، طوارئ' },
  { key: 'infoTint', name: 'معلومة', on: 'infoText', role: 'راكب من الكراج' },
];

function Swatch({ s }: { s: (typeof SWATCHES)[number] }) {
  const theme = useTheme();
  const bg = theme.colors[s.key];
  const fg = theme.colors[s.on];
  const ratio = contrastRatio(fg, bg);
  return (
    <View style={{ width: 150, gap: theme.space[2] }}>
      <View
        style={{
          height: 92,
          borderRadius: theme.radius.lg,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: theme.colors.border,
          padding: theme.space[3],
          justifyContent: 'space-between',
        }}
      >
        <Text variant="title" color={fg}>
          {s.name}
        </Text>
        <Text variant="caption" color={fg} tabular weight={600}>
          {`${ratio.toFixed(1)}:1`}
        </Text>
      </View>
      <View>
        <Text variant="label" tabular weight={600}>
          {ltr(bg)}
        </Text>
        <Caption>{s.role}</Caption>
      </View>
    </View>
  );
}

function Hero() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 980;
  return (
    <View style={{ paddingTop: wide ? theme.space[12] : theme.space[8], paddingBottom: theme.space[10], gap: theme.space[6] }}>
      <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'flex-end' : 'flex-start', justifyContent: 'space-between', gap: theme.space[6] }}>
        <View style={{ gap: theme.space[2], flexShrink: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="location-arrow" size={28} color="onAccent" strokeWidth={2.2} filled />
            </View>
            <Text style={{ fontSize: wide ? 64 : 44, lineHeight: wide ? 84 : 60 }} weight={700}>
              {t('app.customer')}
            </Text>
          </View>
          <Text variant="title" weight={500} color="textMuted" style={{ maxWidth: 560 }}>
            نظام التصميم المشترك لتطبيق الزبون، درايفر بارتنر، ودرايفر للمطاعم. كل مكوّن يشتغل من اليمين لليسار أول، وبالعراقي.
          </Text>
        </View>
        <View style={{ gap: theme.space[2], minWidth: wide ? 360 : undefined, alignSelf: wide ? 'auto' : 'stretch' }}>
          <Button label={t('home.order_now')} trailing={formatIqd(19250)} size="lg" fullWidth />
          <Caption>الزر الرئيسي: حبر غامق على البرتقالي. الأبيض على #E08A1E نسبته 2.7:1 وما ينقرا.</Caption>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[4] }}>
        {SWATCHES.map((s) => (
          <Swatch key={s.key} s={s} />
        ))}
      </View>
    </View>
  );
}

/* ───────────────────────── sections ───────────────────────── */

function TypeSection() {
  const theme = useTheme();
  const rows: { v: keyof typeof theme.type; sample: string }[] = [
    { v: 'display', sample: t('home.where_to') },
    { v: 'heading', sample: t('intercity.departures_title') },
    { v: 'title', sample: t('order.timeline_title') },
    { v: 'amount', sample: '18,500' },
    { v: 'body', sample: t('order.status.placed_hint') },
    { v: 'label', sample: t('restaurant.delivery_from', { amount: '500' }) },
    { v: 'footnote', sample: t('quote.reason.street_pickup') },
    { v: 'caption', sample: t('intercity.front_seat_hint') },
  ];
  return (
    <Section title="الخط" note="IBM Plex Sans Arabic بأوزان 400 إلى 700. ارتفاع السطر عالي (1.7 للنص) حتى ما تتلاصق نقاط الياء والجيم بالسطر اللي جوه.">
      <Panel gap={3}>
        {rows.map((r) => (
          <View key={r.v} style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[4] }}>
            <View style={{ width: 92 }}>
              <Text variant="caption" color="textMuted" tabular>
                {`${theme.type[r.v].size}/${theme.type[r.v].lineHeight}`}
              </Text>
            </View>
            <Text variant={r.v} tabular={r.v === 'amount'} style={{ flex: 1 }} numberOfLines={1}>
              {r.sample}
            </Text>
          </View>
        ))}
      </Panel>
    </Section>
  );
}

function IconsSection() {
  const theme = useTheme();
  return (
    <Section wide title="الأيقونات" note="خط واحد، 1.75 بكسل، أطراف مدوّرة. الأسهم والشيفرون تنقلب ويا اتجاه القراءة؛ الساعة والسيارة ما تنقلب.">
      <Panel row gap={2}>
        {ICON_NAMES.map((n) => (
          <View key={n} style={{ width: 76, alignItems: 'center', gap: 4, paddingVertical: theme.space[2] }}>
            <Icon name={n} size={26} />
            <Text variant="caption" color="textMuted" style={{ fontSize: 10, lineHeight: 14 }} numberOfLines={1}>
              {n}
            </Text>
          </View>
        ))}
      </Panel>
    </Section>
  );
}

function ButtonsSection() {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);
  return (
    <Section title="الأزرار" note="الضغط يصغّر الزر 3% بسبرنگ سريع ويطلق هزة خفيفة. زر التأكيد يحمل المجموع على الطرف الثاني.">
      <Panel gap={4}>
        <Button
          label={t('checkout.place_order', { amount: '' }).replace(' · ', '').replace(' دينار', '').trim()}
          trailing={formatIqd(19250)}
          size="lg"
          fullWidth
          loading={loading}
          loadingLabel={t('checkout.placing')}
          onPress={() => {
            setLoading(true);
            setTimeout(() => setLoading(false), 1600);
          }}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[3] }}>
          <Button label={t('partner.accept')} icon="check" />
          <Button label={t('cart.add_more')} variant="secondary" icon="plus" />
          <Button label={t('action.see_all')} variant="ghost" />
          <Button label={t('intercity.cancel_rider')} variant="destructive" />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[3], alignItems: 'center' }}>
          <Button label={t('checkout.placing')} loading />
          <Button label={t('action.confirm')} disabled />
          <Button label={t('promo.apply')} size="sm" variant="secondary" />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[3], alignItems: 'center' }}>
          <IconButton icon="arrow-back" accessibilityLabel={t('action.back')} variant="outline" />
          <IconButton icon="cart" accessibilityLabel={t('cart.title')} badge={3} />
          <IconButton icon="bell" accessibilityLabel="الإشعارات" badge />
          <IconButton icon="phone" accessibilityLabel={t('trip.call_driver')} variant="accent" />
          <IconButton icon="chat" accessibilityLabel={t('trip.message_driver')} variant="outline" />
          <IconButton icon="share" accessibilityLabel={t('trip.share')} variant="plain" />
          <IconButton icon="sos" accessibilityLabel={t('trip.sos')} variant="tonal" size={52} />
        </View>
      </Panel>
    </Section>
  );
}

function ChoiceSection() {
  const theme = useTheme();
  const [forWhom, setForWhom] = useState<string[]>(['me']);
  const [filters, setFilters] = useState<string[]>(['open']);
  const [spice, setSpice] = useState<string[]>(['mild']);
  const [pickup, setPickup] = useState<'door' | 'street'>('door');
  const [qty, setQty] = useState(2);
  return (
    <Section title="الاختيار" note="«لمن؟» تعرض الأشخاص كأفاتار، والاختيار ينط بسبرنگ صغير. المقطع ينزلق لمكانه.">
      <Panel gap={5}>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="bodyStrong">{t('item.for_whom')}</Text>
          <ChipGroup
            accessibilityLabel={t('item.for_whom')}
            mode="single"
            required
            value={forWhom}
            onChange={setForWhom}
            items={[
              { id: 'me', label: t('item.for_me'), avatar: { name: 'علي' } },
              { id: 'sara', label: 'سارة', avatar: { name: 'سارة' } },
              { id: 'abuhussein', label: 'أبو حسين', avatar: { name: 'حسين' } },
            ]}
            action={{ label: t('item.add_person'), onPress: () => {} }}
          />
          <Caption>{forWhom[0] === 'me' ? 'نقاط هذا الصنف إلك' : t('item.points_go_to', { name: forWhom[0] === 'sara' ? 'سارة' : 'أبو حسين' })}</Caption>
        </View>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="bodyStrong">{t('item.spice_level')}</Text>
          <ChipGroup
            mode="single"
            required
            value={spice}
            onChange={setSpice}
            items={[
              { id: 'none', label: t('item.spice_none') },
              { id: 'mild', label: t('item.spice_mild') },
              { id: 'hot', label: t('item.spice_hot') },
            ]}
          />
        </View>
        <ChipGroup
          mode="multi"
          value={filters}
          onChange={setFilters}
          items={[
            { id: 'open', label: t('search.filter_open_now'), icon: 'clock' },
            { id: 'free', label: t('search.filter_free_delivery'), icon: 'bike' },
            { id: 'fast', label: t('search.filter_fast') },
          ]}
        />
        <View style={{ gap: theme.space[2] }}>
          <Text variant="bodyStrong">{t('checkout.pickup_mode')}</Text>
          <SegmentedControl
            value={pickup}
            onChange={setPickup}
            options={[
              { value: 'door', label: t('checkout.pickup_door') },
              { value: 'street', label: t('checkout.pickup_street_save', { amount: formatAmount(250) }) },
            ]}
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text variant="bodyStrong">كباب عراقي</Text>
            <Caption>{formatIqd(6000 * qty)}</Caption>
          </View>
          <Stepper value={qty} onChange={setQty} min={1} max={9} accessibilityLabel={t('item.qty')} />
        </View>
      </Panel>
    </Section>
  );
}

function FieldsSection() {
  const theme = useTheme();
  const [q, setQ] = useState('');
  const [phone, setPhone] = useState('0781234');
  return (
    <Section title="الحقول" note="بحث واحد فوق كلشي. الحقل يتلون بالبرتقالي لمن تكتب، وبالأحمر مع جملة تگول شنو تسوي.">
      <Panel gap={4}>
        <SearchField value={q} onChangeText={setQ} placeholder={t('search.placeholder')} onVoice={() => {}} onClear={() => setQ('')} />
        <SearchField value="تكسي للكوت" onChangeText={() => {}} onClear={() => {}} />
        <SearchField placeholder={t('search.placeholder')} onPress={() => {}} />
        <TextField label="رقم الموبايل" value={phone} onChangeText={setPhone} keyboardType="phone-pad" error={t('error.phone_invalid')} />
        <TextField label={t('cart.note_courier')} placeholder={t('cart.note_courier_placeholder')} hint="الدليفري يشوفها لمن يوصل" />
        <TextField placeholder={t('checkout.promo_placeholder')} leadingIcon="gift" trailing={<Button label={t('promo.apply')} size="sm" variant="ghost" />} />
        <View style={{ height: theme.space[1] }} />
      </Panel>
    </Section>
  );
}

function CardsSection() {
  const theme = useTheme();
  return (
    <Section title="البطاقات والقوائم" note="البطاقة تبين التوصيل وأقل طلب قبل ما تفتح المطعم. الصفوف تنتهي بشيفرون يأشر لاتجاه القراءة.">
      <View style={{ gap: theme.space[4] }}>
        <Card padding={0} onPress={() => {}} accessibilityLabel="مطعم خالد">
          <View style={{ height: 120, borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl, overflow: 'hidden' }}>
            <FoodArt />
            <View style={{ position: 'absolute', top: theme.space[3], start: theme.space[3] }}>
              <StatusPill label={t('restaurant.double_points')} tone="accent" icon="star" size="sm" />
            </View>
          </View>
          <View style={{ padding: theme.space[4], gap: theme.space[1] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text variant="title">مطعم خالد</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name="star" size={16} color="accent" filled />
                <Text variant="label" tabular>
                  {t('restaurant.rating', { rating: '4.6', count: 312 })}
                </Text>
              </View>
            </View>
            <Text variant="footnote" color="textMuted">
              كباب، تكة، كبد · الشارع العام
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2], marginTop: theme.space[2] }}>
              <StatusPill label={t('checkout.eta', { min: 25, max: 35 })} icon="clock" size="sm" />
              <StatusPill label={t('restaurant.delivery_from', { amount: '500' })} icon="bike" size="sm" />
              <StatusPill label={t('restaurant.min_order', { amount: '5,000' })} size="sm" />
            </View>
          </View>
        </Card>
        <Card padding={0} elevation={0}>
          <ListRow leading="map-pin" title="البيت" subtitle="خلف صيدلية الرازي، باب أزرق" trailing={<StatusPill label={t('checkout.place_confirmed_badge')} tone="success" size="sm" icon="check" />} divider onPress={() => {}} chevron={false} />
          <ListRow leading="wallet" title={t('nav.wallet')} value={formatIqd(12000)} divider onPress={() => {}} />
          <ListRow leading={<Avatar name="سارة" />} title="سارة" subtitle={t('item.person_note', { name: 'سارة' }) + ': بدون بصل'} divider onPress={() => {}} />
          <ListRow leading="receipt" title={t('order.receipt')} subtitle="طلب #4821 · 7:42" onPress={() => {}} selected />
        </Card>
        <Panel gap={3}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            <StatusPill label={t('order.status.preparing')} tone="accent" live />
            <StatusPill label={t('order.status.delivered')} tone="success" icon="check" />
            <StatusPill label={t('restaurant.busy').split('،')[0]!} tone="warning" dot />
            <StatusPill label={t('order.status.merchant_rejected')} tone="danger" />
            <StatusPill label={t('status.online')} tone="success" live />
            <StatusPill label={t('quote.quote_locked')} tone="info" icon="shield" />
            <StatusPill label={t('status.offline')} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space[3] }}>
            <Avatar name="علي" size={48} ring />
            <Avatar name="سارة" size={40} />
            <Avatar name="مريم" size={40} />
            <Avatar name="كرار" size={40} />
            <Avatar icon="plus" tone="accent" size={40} />
            <View style={{ flexDirection: 'row', gap: theme.space[2], marginStart: 'auto' }}>
              <Badge count={3} />
              <Badge count={120} tone="danger" />
              <Badge />
            </View>
          </View>
        </Panel>
      </View>
    </Section>
  );
}

const PRICE_BASE: PriceItem[] = [
  { key: 'delivery', label: t('quote.delivery'), amount: 1500, reason: t('quote.reason.delivery_full') },
  { key: 'service_fee', label: t('quote.service_fee'), amount: 500, reason: t('quote.reason.service_fee') },
  { key: 'street_pickup', label: t('quote.street_pickup'), amount: -250, reason: t('quote.reason.street_pickup') },
  { key: 'promo', label: t('quote.promo_named', { name: 'أول طلب' }), amount: -1500, reason: t('quote.reason.promo', { funder: t('quote.funder_platform') }) },
  { key: 'distance', label: t('quote.distance'), amount: 750, shadow: true },
  { key: 'time', label: t('quote.time'), amount: 400, shadow: true },
];

function PriceSection() {
  const theme = useTheme();
  const [kebab, setKebab] = useState(2);
  const items = useMemo<PriceItem[]>(
    () => [{ key: 'subtotal', label: t('quote.subtotal'), amount: 7000 + kebab * 6000 }, ...PRICE_BASE],
    [kebab],
  );
  const [shadow, setShadow] = useState<'customer' | 'partner'>('customer');
  return (
    <Section title="السعر" note="كل رسم إله اسم وسبب (اضغط السطر). السطور المظللة محسوبة بس ما تنحسب. المجموع يعد لفوق لمن يتغير.">
      <Panel gap={4}>
        <SegmentedControl
          value={shadow}
          onChange={setShadow}
          options={[
            { value: 'customer', label: 'شاشة الزبون' },
            { value: 'partner', label: 'مع السطور المظللة' },
          ]}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="label" color="textMuted">
            كباب عراقي × {kebab}
          </Text>
          <Stepper size="sm" value={kebab} onChange={setKebab} min={1} max={9} />
        </View>
        <PriceBreakdown items={items} showShadow={shadow === 'partner'} note={t('quote.quote_locked')} />
      </Panel>
      <View style={{ height: theme.space[4] }} />
      <Panel gap={2}>
        <Text variant="label" color="textMuted">
          تقريب لأقرب 250
        </Text>
        <PriceBreakdown
          testID="taxi"
          items={[
            { key: 'base', label: t('quote.base'), amount: 2000 },
            { key: 'door_pickup', label: t('quote.door_pickup'), amount: 500, reason: t('quote.reason.door_pickup') },
            { key: 'night', label: t('quote.night'), amount: 350, reason: t('quote.reason.night', { time: '11:00' }) },
          ]}
        />
      </Panel>
    </Section>
  );
}

/* ───────────────────────── tracking (map + sheet) ───────────────────────── */

function MapArt() {
  const theme = useTheme();
  const c = theme.colors;
  // Sized to the phone frame (344 × 684) so nothing important is cropped.
  return (
    <Svg width="100%" height="100%" viewBox="0 0 344 684" preserveAspectRatio="xMidYMin slice">
      <Rect x={0} y={0} width={344} height={684} fill="#F1E9DB" />
      {/* River (Tigris) along the bottom */}
      <Path d="M-10 560 C 70 520, 140 600, 220 560 S 320 510, 360 540 L 360 700 L -10 700 Z" fill="#D9E6EE" />
      {[
        [16, 70, 80, 66], [124, 70, 72, 66], [224, 70, 104, 66], [16, 166, 80, 120], [124, 166, 72, 56], [124, 238, 72, 48],
        [224, 166, 50, 120], [300, 166, 40, 120], [16, 316, 80, 110], [124, 316, 72, 110], [224, 316, 104, 50], [224, 392, 50, 34],
      ].map(([x, y, w, h], i) => (
        <Rect key={i} x={x} y={y} width={w} height={h} rx={6} fill="#E8DECD" />
      ))}
      {/* Streets */}
      <Path d="M0 151 H344 M0 301 H344 M0 441 H344 M110 40 V520 M210 40 V520 M287 140 V460" stroke="#FFFFFF" strokeWidth={9} />
      {/* Travelled path (faded) and the remaining route */}
      <Path d="M60 100 V151 H110" stroke={c.accent} strokeWidth={5} strokeOpacity={0.3} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray="2 8" />
      <Path d="M110 151 H210 V301 H287 V420" stroke={c.accent} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Courier */}
      <Circle cx={110} cy={151} r={22} fill={c.accent} fillOpacity={0.18} />
      <Circle cx={110} cy={151} r={13} fill={c.accent} stroke="#FFFFFF" strokeWidth={3} />
      {/* Home pin with gate */}
      <Rect x={271} y={420} width={32} height={32} rx={10} fill={c.text} />
      <Path d="M279 438 L287 431 L295 438 M281 436 V444 H293 V436" stroke="#FFFFFF" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const STEPS: TimelineStep[] = [
  { key: 'placed', label: t('order.status.placed'), time: '7:02' },
  { key: 'accepted', label: t('order.status.merchant_accepted'), time: '7:03' },
  { key: 'preparing', label: t('order.status.preparing'), time: '7:05' },
  {
    key: 'picked_up',
    label: t('order.status.picked_up'),
    time: '7:24',
    note: 'تأخرنا 6 دقايق وهذا غلطنا. ضفنالك 1,000 دينار رصيد',
    late: true,
  },
  { key: 'delivered', label: t('order.status.delivered'), time: '7:42' },
];

function TrackingPhone({ snap }: { snap: number }) {
  const theme = useTheme();
  return (
    <PhoneFrame>
      <MapArt />
      <View style={{ position: 'absolute', top: theme.space[4], start: theme.space[4], end: theme.space[4], flexDirection: 'row', justifyContent: 'space-between' }}>
        <IconButton icon="arrow-back" accessibilityLabel={t('action.back')} variant="outline" />
        <Button label={t('trip.share')} icon="share" size="sm" variant="secondary" />
      </View>
      <Sheet
        snapPoints={[116, 0.55, 0.86]}
        initialSnap={snap}
        header={
          <View style={{ gap: 0 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text variant="title">{t('order.status.picked_up')}</Text>
              <Text variant="title" color="accentText" tabular>
                7:42
              </Text>
            </View>
            <Text variant="footnote" color="textMuted">
              {t('order.eta_batched', { time: '7:42' })}
            </Text>
          </View>
        }
      >
        <View style={{ gap: theme.space[4] }}>
          <CourierCard />
          <Timeline steps={STEPS} current="picked_up" />
        </View>
      </Sheet>
    </PhoneFrame>
  );
}

function TrackingSection() {
  const theme = useTheme();
  return (
    <Section
      wide
      title="التتبع الحي"
      note="الخريطة وفوكاها شيت ينسحب بين ثلاث وقفات: مطوي (الحالة والوقت)، نص، ومفتوح (الدليفري والخطوات). الخطوة الحالية تنبض؛ التأخير ينكتب بصراحة ويا التعويض."
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[6], justifyContent: 'center' }}>
        <View style={{ alignItems: 'center', gap: theme.space[2] }}>
          <TrackingPhone snap={0} />
          <Caption>مطوي</Caption>
        </View>
        <View style={{ alignItems: 'center', gap: theme.space[2] }}>
          <TrackingPhone snap={2} />
          <Caption>مفتوح</Caption>
        </View>
        <View style={{ width: 320, gap: theme.space[4] }}>
          <Panel gap={3}>
            <Text variant="bodyStrong">{t('trip.status.en_route_to_pickup')}</Text>
            <Timeline
              steps={[
                { key: 'matched', label: t('order.status.matched'), time: '4:58' },
                { key: 'enroute', label: t('trip.status.en_route_to_pickup'), time: '5:01' },
                { key: 'arrived', label: t('trip.status.arrived_pickup'), time: '5:06' },
                { key: 'transit', label: t('trip.status.in_transit') },
              ]}
              current="arrived"
            />
          </Panel>
          <Panel gap={3}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], flexWrap: 'wrap' }}>
              <StatusPill label={t('trip.driver_arrived')} tone="success" live />
              <Text variant="label" color="textMuted">
                {t('trip.wait_free_left', { seconds: 94 })}
              </Text>
            </View>
            <Button label={t('trip.wait_for_me')} variant="secondary" icon="clock" fullWidth />
          </Panel>
        </View>
      </View>
    </Section>
  );
}

function CourierCard() {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        padding: theme.space[3],
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.bg,
      }}
    >
      <Avatar name="حسين" size={52} ring />
      <View style={{ flex: 1, gap: 0 }}>
        <Text variant="bodyStrong">حسين كريم</Text>
        <Text variant="caption" color="successText" weight={600}>
          {t('trip.verified_today')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text variant="caption" color="textMuted">
            تكتك
          </Text>
          <Text variant="caption" color="text" weight={600} tabular numberOfLines={1} style={{ flexShrink: 0 }}>
            23 ب 8841
          </Text>
          <Icon name="star" size={12} color="accent" filled />
          <Text variant="caption" color="textMuted" tabular>
            4.9
          </Text>
        </View>
      </View>
      <IconButton icon="chat" accessibilityLabel={t('trip.message_driver')} variant="outline" />
      <IconButton icon="phone" accessibilityLabel={t('trip.call_driver')} variant="accent" />
    </View>
  );
}

function PhoneFrame({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 360,
        height: 700,
        borderRadius: 40,
        overflow: 'hidden',
        backgroundColor: theme.colors.bg,
        borderWidth: 8,
        borderColor: theme.colors.text,
      }}
    >
      {children}
    </View>
  );
}

/* ───────────────────────── الرجعة: garage board + seat map ───────────────────────── */

const CAR_4: SeatInfo[] = [
  { id: 'front', state: 'free', premium: 2000 },
  { id: 'back_left', state: 'taken' },
  { id: 'back_middle', state: 'walkup' },
  { id: 'back_right', state: 'free' },
];
const CAR_7: SeatInfo[] = [
  { id: 'front', state: 'taken', premium: 2000 },
  { id: 'middle_left', state: 'free' },
  { id: 'middle_middle', state: 'held' },
  { id: 'middle_right', state: 'free' },
  { id: 'rear_left', state: 'walkup' },
  { id: 'rear_middle', state: 'free' },
  { id: 'rear_right', state: 'taken' },
];
const CAR_6: SeatInfo[] = [
  { id: 'front', state: 'free', premium: 2000 },
  { id: 'middle_left', state: 'taken' },
  { id: 'middle_right', state: 'taken' },
  { id: 'rear_left', state: 'free' },
  { id: 'rear_middle', state: 'taken' },
  { id: 'rear_right', state: 'walkup' },
];

function GarageSection() {
  const theme = useTheme();
  const toast = useToast();
  const [sel4, setSel4] = useState<SeatId[]>(['front']);
  const [sel7, setSel7] = useState<SeatId[]>([]);
  const reject = () => toast.show({ message: t('error.seat_taken'), tone: 'danger', icon: 'seat' });
  const price = 10000 + (sel4.includes('front') ? 2000 : 0);
  return (
    <Section wide title="الرجعة" note="لوحة الكراج: صورة السايق والرقم، «يمشي الساعة 5:30 أو لمن تمتلي»، وخريطة المقاعد. القدام برتقالي، المحجوز رمادي، راكب الكراج أزرق، والحجز المؤقت خط متقطع.">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[5] }}>
        <View style={{ flexGrow: 1, flexBasis: 340, maxWidth: 420, gap: theme.space[3] }}>
          <SegmentedControl
            value="back"
            onChange={() => {}}
            options={[
              { value: 'back', label: 'بغداد ← العزيزية' },
              { value: 'out', label: 'العزيزية ← بغداد' },
            ]}
          />
          <Card tone="tint" padding={4}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">9 أشخاص يريدون يرجعون بين 4 و6</Text>
                <Text variant="footnote" color="textMuted">
                  انضم وتجيك سيارة بدل ما تدوّر عليها
                </Text>
              </View>
              <Button label="أريد أرجع" size="sm" variant="secondary" />
            </View>
          </Card>
          <GarageDeparture
            driver="أبو حسين"
            car="تويوتا كامري · 23 أ 1120"
            when={t('intercity.departure_at', { time: '5:30' })}
            whenNote="أو لمن تمتلي"
            seats={CAR_4}
            pill={<StatusPill label={t('intercity.seats_left', { n: 2 })} tone="success" size="sm" dot />}
          />
          <GarageDeparture
            driver="كرار عبد"
            car="جي إم سي · 23 ب 7731"
            when="يمشي هسة"
            seats={CAR_6}
            layout={6}
            pill={<StatusPill label={t('intercity.last_seat')} tone="warning" size="sm" dot />}
          />
        </View>
        <View style={{ flexGrow: 1, flexBasis: 340, minWidth: 0 }}>
        <Panel gap={4}>
          <Text variant="title">{t('intercity.choose_seat')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[8], justifyContent: 'center', alignItems: 'flex-start' }}>
            <View style={{ alignItems: 'center', gap: theme.space[2] }}>
              <SeatMap layout={4} seats={CAR_4} selection={sel4} onChange={setSel4} onReject={reject} legend={false} />
              <Caption>صالون، 4 مقاعد</Caption>
            </View>
            <View style={{ alignItems: 'center', gap: theme.space[2] }}>
              <SeatMap layout={7} seats={CAR_7} selection={sel7} onChange={setSel7} onReject={reject} max={2} legend={false} />
              <Caption>7 مقاعد، تگدر تختار مقعدين</Caption>
            </View>
          </View>
          <SeatLegend />
          <Text variant="footnote" color="accentText" weight={600} align="center">
            {t('intercity.front_seat_premium', { amount: '2,000' })}
          </Text>
          <Button
            label={sel4.length ? t('intercity.pay_prepaid') : t('intercity.choose_seat')}
            trailing={sel4.length ? formatIqd(price) : undefined}
            disabled={!sel4.length}
            fullWidth
            size="lg"
          />
        </Panel>
        </View>
      </View>
    </Section>
  );
}

function GarageDeparture({
  driver,
  car,
  when,
  whenNote,
  seats,
  layout = 4,
  pill,
}: {
  driver: string;
  car: string;
  when: string;
  whenNote?: string;
  seats: SeatInfo[];
  layout?: 4 | 6 | 7;
  pill: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Card padding={4}>
      <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
        <View style={{ flex: 1, gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <Avatar name={driver.replace('أبو ', '')} size={44} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{driver}</Text>
              <Text variant="caption" color="textMuted" tabular numberOfLines={1}>
                {car}
              </Text>
            </View>
          </View>
          <View style={{ gap: 2 }}>
            <Text variant="bodyStrong" color="accentText">
              {when}
            </Text>
            {whenNote ? (
              <Text variant="caption" color="textMuted">
                {whenNote}
              </Text>
            ) : null}
          </View>
          {pill}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="label" color="textMuted">
              المقعد
            </Text>
            <Text variant="label" tabular weight={600}>
              {formatIqd(10000)}
            </Text>
          </View>
        </View>
        <SeatMap layout={layout} seats={seats} selection={[]} compact legend={false} />
      </View>
    </Card>
  );
}

/* ───────────────────────── timers ───────────────────────── */

/** Restarts itself on expiry so the specimen keeps moving. */
function LoopingAcceptRing({ durationMs, offsetMs, ...rest }: { durationMs: number; offsetMs: number; caption?: string; size?: number; strokeWidth?: number }) {
  const [startedAt, setStartedAt] = useState(() => Date.now() - offsetMs);
  return (
    <CountdownRing
      key={startedAt}
      mode="accept"
      startedAt={startedAt}
      durationMs={durationMs}
      onExpire={() => setTimeout(() => setStartedAt(Date.now()), 1200)}
      {...rest}
    />
  );
}

const LATE = { graceMs: 180_000, stepMs: 600_000, stepAmount: 1000, forfeitMs: 1_200_000 };

function TimersSection() {
  const theme = useTheme();
  const [start] = useState(() => Date.now());
  const frozen = useMemo(() => () => start, [start]);
  return (
    <Section title="المؤقتات" note="حلقة القبول تنقص وتصير حمرة آخر 5 ثواني. عداد التأخير: سماح، بعدين مبلغ كل 10 دقايق، وبعد 20 دقيقة السيارة تمشي.">
      <Panel row gap={6}>
        <View style={{ alignItems: 'center', gap: theme.space[2] }}>
          <LoopingAcceptRing durationMs={20000} offsetMs={6000} caption="ثانية" />
          <Caption>{t('partner.offer_title')}: 20 ثانية</Caption>
        </View>
        <View style={{ alignItems: 'center', gap: theme.space[2] }}>
          <CountdownRing mode="accept" startedAt={start - 16500} durationMs={20000} caption="ثانية" clock={frozen} paused />
          <Caption>آخر 5 ثواني</Caption>
        </View>
        <View style={{ alignItems: 'center', gap: theme.space[2] }}>
          <LoopingAcceptRing durationMs={90000} offsetMs={31000} size={96} strokeWidth={7} />
          <Caption>قبول المطعم: 90 ثانية</Caption>
        </View>
        <View style={{ alignItems: 'center', gap: theme.space[2] }}>
          <CountdownRing mode="late" startedAt={start - 60_000} config={LATE} />
          <Caption>سماح قبل العداد</Caption>
        </View>
        <View style={{ alignItems: 'center', gap: theme.space[2] }}>
          <CountdownRing mode="late" startedAt={start - 14 * 60_000} config={LATE} />
          <Caption>متأخر 11 دقيقة: 2,000 دينار</Caption>
        </View>
        <View style={{ alignItems: 'center', gap: theme.space[2] }}>
          <SegmentRing count={7} size={112} strokeWidth={7}>
            <Icon name="check" size={36} color="successText" strokeWidth={2.6} />
          </SegmentRing>
          <Caption>خلصت الطلب: حلقة طلبات اليوم (7)</Caption>
        </View>
      </Panel>
    </Section>
  );
}

/* ───────────────────────── departure board time ───────────────────────── */

/** A clock that moves a minute every 2.5 s so the split-flap tick can be seen (and a 9:59 → 10:00 roll). */
function useDemoClock(startMs: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), 2500);
    return () => clearInterval(id);
  }, []);
  return startMs + n * 60_000;
}

/** The garage-board time (customer audit d-2): the motif on الرجعة, khat and the food ETA. */
function DepartureTimeSection() {
  const theme = useTheme();
  const [now] = useState(() => Date.now());
  // 9:58 م in Baghdad today (UTC+3), rolling forward a minute at a time.
  const base = useMemo(() => {
    const d = new Date(now);
    d.setUTCHours(18, 58, 0, 0);
    return d.getTime();
  }, [now]);
  const rolling = useDemoClock(base);
  return (
    <Section title="وقت الكراج" note="الوقت مثل لوحة الكراج: أرقام كبيرة على مربعات، ص/م، واليوم إذا مو اليوم، و«بعد 52 دقيقة». الرقم اللي يتغير ينگلب (180 ملي ثانية)؛ إذا الحركة مخففة يتبدل بلا حركة. نفس الوقت للرجعة والخطوط ووقت وصول الأكل.">
      <Panel gap={5}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[6], alignItems: 'flex-start' }}>
          <View style={{ gap: theme.space[2] }}>
            <DepartureTime at={rolling} now={base - 52 * 60_000} size="hero" label={t('departure_time.leaves')} countdown={false} testID="gallery-dt-roll" />
            <Caption>كبير · ينگلب كل دقيقة</Caption>
          </View>
          <View style={{ gap: theme.space[2] }}>
            <DepartureTime at={now + 52 * 60_000} now={now} size="card" label={t('departure_time.leaves')} />
            <Caption>بطاقة · اليوم</Caption>
          </View>
          <View style={{ gap: theme.space[2] }}>
            {/* 9:58 م + 9 h 30 min: 7:28 ص the next morning. */}
            <DepartureTime at={base + 9.5 * 3600_000} now={now} size="card" note="أو من تكمل" />
            <Caption>بطاقة · باچر</Caption>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[6], alignItems: 'flex-start' }}>
          <View style={{ gap: theme.space[2], backgroundColor: theme.colors.accentTint, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
            <DepartureTime at={now + 18 * 60_000} now={now} size="compact" label={t('track.eta_label')} />
          </View>
          <View style={{ gap: theme.space[2], backgroundColor: theme.colors.warningTint, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
            <DepartureTime at={now + 31 * 60_000} now={now} size="compact" label={t('track.eta_label')} tone="warning" />
          </View>
          <View style={{ gap: theme.space[2] }}>
            <DepartureTime at={now + 9 * 60_000} now={now} size="compact" label={t('partner.kh2_next_stop')} tone="quiet" />
          </View>
          <View style={{ gap: theme.space[2] }}>
            <DepartureTime at={now + 3 * 60_000} now={now} size="compact" tone="success" note={t('rajaa.boarding_now')} />
          </View>
        </View>
      </Panel>
    </Section>
  );
}

/* ───────────────────────── confirm ───────────────────────── */

/** Accept, slide and hold (partner P-03, P-08) and the one modal sheet (S-12). */
function ConfirmSection() {
  const theme = useTheme();
  const toast = useToast();
  const [start, setStart] = useState(() => Date.now());
  const [sheet, setSheet] = useState(false);
  const done = (what: string) => toast.show({ message: what, tone: 'success', icon: 'check' });
  return (
    <Section title="التأكيد" note="القبول ضغطة وحدة والوقت يخلص جوه الزر. استلمت وسلّمت سحب للآخر (بالعربي من اليمين لليسار)؛ إذا الحركة مخففة يصير ضغط وتثبيت. الشيت نافذة مقفولة: الرجوع وEscape والخلفية تسكّرها.">
      <Panel gap={4}>
        <CountdownButton key={start} label={t('partner.accept')} startedAt={start} durationMs={15_000} onPress={() => done(t('partner.offer_accepted'))} onExpire={() => setTimeout(() => setStart(Date.now()), 1500)} />
        <HoldButton label={t('partner.slip_hold')} holdHint={t('partner.slip_hold_hint')} confirmLabel={t('partner.slip_confirm')} trailing="12" onConfirm={() => done(t('partner.offer_accepted'))} testID="gallery-hold-button" />
        <HoldButton label={t('partner.slip_hold')} holdHint={t('partner.slip_hold_hint')} confirmLabel={t('partner.slip_confirm')} screenReader onConfirm={() => done(t('partner.offer_accepted'))} testID="gallery-hold-button-reader" />
        <SlideToConfirm label={t('partner.action_picked_up')} onConfirm={() => done(t('partner.action_picked_up'))} mode="slide" testID="gallery-slide" />
        <SlideToConfirm label={t('partner.ic_depart_cta')} onConfirm={() => done(t('partner.ic_depart_cta'))} mode="hold" testID="gallery-hold" />
        <Button label="افتح الشيت" variant="secondary" onPress={() => setSheet(true)} />
        <ModalSheet visible={sheet} onClose={() => setSheet(false)} title={t('partner.handover_title')} footer={<Button label={t('action.close')} fullWidth onPress={() => setSheet(false)} />}>
          <Text variant="body" color="textMuted">
            {t('partner.cash_hint')}
          </Text>
          <View style={{ height: theme.space[2] }} />
        </ModalSheet>
      </Panel>
    </Section>
  );
}

/* ───────────────────────── voice notes ───────────────────────── */

/** Voice notes in the chat (ride ideas n7/n8): the player's states, the recorder bar, the mic. */
function VoiceSection() {
  const theme = useTheme();
  const [playing, setPlaying] = useState(false);
  const [slide, setSlide] = useState(0);
  return (
    <Section title="الرسائل الصوتية" note="اضغط مطوّل على المايك وسجّل، فلّت حتى تدز، واسحب لليمين حتى تلغي. المشغّل زر واحد وخط تقدّم والثواني، بدون موجات.">
      <Panel gap={4}>
        <VoiceNotePlayer durationSec={12} available t={t} state={playing ? 'playing' : 'idle'} positionSec={playing ? 5 : 0} onToggle={() => setPlaying((p) => !p)} />
        <VoiceNotePlayer durationSec={8} available t={t} state="loading" positionSec={0} />
        <VoiceNotePlayer durationSec={8} available={false} t={t} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <VoiceRecorderBar elapsedMs={7_400} slide={slide} t={t} />
          <MicHoldButton recording onHoldStart={() => undefined} onHoldMove={(dx) => setSlide(Math.max(0, Math.min(1, dx / 96)))} onHoldEnd={() => setSlide(0)} onHoldAbort={() => setSlide(0)} onActivate={() => undefined} t={t} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <VoiceRecorderBar elapsedMs={21_000} slide={0} locked t={t} onDiscard={() => undefined} onSend={() => undefined} />
        </View>
      </Panel>
    </Section>
  );
}

/* ───────────────────────── SOS ───────────────────────── */

function SosSection() {
  const theme = useTheme();
  const toast = useToast();
  const [start] = useState(() => Date.now());
  const frozen = useMemo(() => () => start, [start]);
  return (
    <Section title="الطوارئ" note="اضغط 3 ثواني: الحلقة تتعبى بالأحمر وكل ثانية هزة. إذا شلت إصبعك قبلها ما ينرسل شي. بعد ما يوصل، 10 ثواني تگدر تكنسل.">
      <Panel row gap={6}>
        <View style={{ alignItems: 'center', gap: theme.space[2] }}>
          <SosButton onTrigger={() => toast.show({ message: t('safety.sos_sent'), tone: 'danger', icon: 'sos' })} onRelease={() => toast.show({ message: t('sos.released'), tone: 'info' })} />
          <Caption>بالهيدر</Caption>
        </View>
        <View style={{ alignItems: 'center', gap: theme.space[2] }}>
          <SosButton variant="round" onTrigger={() => toast.show({ message: t('safety.sos_sent'), tone: 'danger', icon: 'sos' })} />
          <Caption>دائري</Caption>
        </View>
        <View style={{ alignItems: 'center', gap: theme.space[2] }}>
          <SosButton active onTrigger={() => undefined} onPressActive={() => undefined} />
          <Caption>التنبيه شغّال</Caption>
        </View>
      </Panel>
      <View style={{ height: 470, borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
        <SosSheet phase="open" policeNumber={SAFETY_RULES.policeNumber} cancelUntil={start + 8_000} clock={frozen} contactName="أم زينب" onCancel={() => undefined} onClose={() => undefined} onCallPolice={() => undefined} />
      </View>
      {/* Rider layout (customer rides, L-17): police first, the car to read out, no contact → share my location. */}
      <View style={{ height: 560, borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
        <SosSheet
          layout="rider"
          phase="open"
          policeNumber={SAFETY_RULES.policeNumber}
          car="عباس · تويوتا كورولا أبيض · واسط 31207"
          cancelUntil={start + 8_000}
          clock={frozen}
          contactName={null}
          onShareLocation={() => undefined}
          onCancel={() => undefined}
          onClose={() => undefined}
          onCallPolice={() => undefined}
        />
      </View>
    </Section>
  );
}

/* ───────────────────────── states ───────────────────────── */

/** Every state of the shared QueryBoundary, from fake query results (no network needed). */
function QueryBoundaryStates() {
  const theme = useTheme();
  const fake = (over: Partial<QueryLike<string[]>>): QueryLike<string[]> => ({ data: undefined, error: null, isPending: false, isError: false, fetchStatus: 'idle', refetch: () => {}, ...over });
  const answered = (httpStatus: number, code: string, message_ar: string) => Object.assign(new Error(code), { data: { httpStatus, code, message_ar, message_en: code } });
  const states: { label: string; query: QueryLike<string[]>; slowMs?: number; size?: 'inline' }[] = [
    { label: 'يحمّل', query: fake({ isPending: true, fetchStatus: 'fetching' }), slowMs: 60 * 60_000 },
    { label: 'أخذ وقت (بعد 8 ثواني)', query: fake({ isPending: true, fetchStatus: 'fetching' }), slowMs: 0 },
    { label: 'ما گدرنا نوصل', query: fake({ isError: true, error: Object.assign(new Error('request_timeout'), { name: 'TimeoutError' }) }) },
    { label: 'مشكلة من عدنا', query: fake({ isError: true, error: answered(500, 'internal', 'مشكلة من عدنا') }) },
    { label: 'جواب نهائي من السيرفر', query: fake({ isError: true, error: answered(409, 'store_closed', 'المطعم مسكّر هسه. يفتح الساعة 4 العصر') }) },
    { label: 'مو موجود', query: fake({ isError: true, error: answered(404, 'not_found', 'ما لگينا المطلوب') }) },
    { label: 'فارغ', query: fake({ data: [] }) },
    { label: 'البيانات القديمة تبقى إذا فشل التحديث', query: fake({ data: ['كباب', 'تكة'], isError: true, error: answered(500, 'internal', 'مشكلة من عدنا'), dataUpdatedAt: Date.now() - 180_000 }) },
    { label: 'قسم داخل الشاشة (inline): ما گدرنا نوصل', query: fake({ isError: true, error: Object.assign(new Error('request_timeout'), { name: 'TimeoutError' }) }), size: 'inline' },
    { label: 'قسم داخل الشاشة (inline): مشكلة من عدنا', query: fake({ isError: true, error: answered(500, 'internal', 'مشكلة من عدنا') }), size: 'inline' },
  ];
  return (
    <View style={{ gap: theme.space[3] }}>
      <Text variant="label" color="textMuted">
        QueryBoundary
      </Text>
      {states.map((s) => (
        <Panel key={s.label} gap={2} pad={4}>
          <Text variant="caption" color="textMuted">
            {s.label}
          </Text>
          <QueryBoundary
            query={s.query}
            slowMs={s.slowMs}
            size={s.size}
            skeleton={<Skeleton lines={3} />}
            isEmpty={(d) => d.length === 0}
            empty={{ icon: 'receipt', title: t('empty.orders'), body: t('empty.orders_hint'), action: { label: t('home.order_now'), onPress: () => {} } }}
            gone={s.label === 'مو موجود' ? { icon: 'receipt', title: 'هذا الطلب مو موجود', body: 'يمكن الرابط قديم.' } : undefined}
          >
            {(rows) => <Text variant="body">{rows.join(' · ')}</Text>}
          </QueryBoundary>
        </Panel>
      ))}
    </View>
  );
}

function StatesSection() {
  const theme = useTheme();
  const toast = useToast();
  return (
    <Section title="الحالات" note="الفراغ دعوة لخطوة، التحميل شيمر يمشي من اليمين، والتنبيه يطلع من جوه.">
      <View style={{ gap: theme.space[4] }}>
        <Panel gap={0} pad={4}>
          <EmptyState icon="receipt" title={t('empty.orders')} body={t('empty.orders_hint')} action={{ label: t('home.order_now'), onPress: () => {} }} />
        </Panel>
        <Panel gap={3}>
          <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}>
            <Skeleton width={64} height={64} radius={14} />
            <View style={{ flex: 1 }}>
              <Skeleton lines={3} />
            </View>
          </View>
          <Skeleton height={120} radius={16} />
        </Panel>
        <QueryBoundaryStates />
        <View style={{ gap: theme.space[2] }}>
          <Toast message={t('intercity.booked')} tone="success" />
          <Toast message={t('error.network')} tone="danger" action={{ label: t('action.retry'), onPress: () => {} }} onDismiss={() => {}} />
          <Toast message={t('trip.rebroadcast', { amount: '500' })} tone="info" icon="car" />
          <Button
            label="جرّب التنبيه"
            variant="secondary"
            onPress={() => toast.show({ message: t('promo.applied', { name: 'أول طلب' }), tone: 'success', icon: 'gift' })}
          />
        </View>
      </View>
    </Section>
  );
}

function FoodArt() {
  // Flat illustration placeholder for a dish photo: skewers on a tray.
  return (
    <Svg width="100%" height="100%" viewBox="0 0 400 120" preserveAspectRatio="xMidYMid slice">
      <Rect width={400} height={120} fill="#F4DDBA" />
      <Rect x={40} y={30} width={320} height={70} rx={35} fill="#E9C48E" />
      {[0, 1, 2].map((i) => (
        <Path key={i} d={`M70 ${48 + i * 16} H330`} stroke="#8A5300" strokeWidth={3} strokeLinecap="round" />
      ))}
      {[0, 1, 2].flatMap((row) =>
        [0, 1, 2, 3, 4, 5].map((k) => (
          <Rect key={`${row}-${k}`} x={95 + k * 36} y={41 + row * 16} width={26} height={14} rx={7} fill={k % 2 ? '#9A5200' : '#B4642A'} />
        )),
      )}
    </Svg>
  );
}

/* ───────────────────────── root ───────────────────────── */

function Page() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const gutter = width < 600 ? 16 : 40;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.bg }} contentContainerStyle={{ alignItems: 'center' }}>
      <View style={{ width: '100%', maxWidth: 1200, paddingHorizontal: gutter, paddingBottom: theme.space[16] }}>
        <Hero />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: width >= 980 ? -theme.space[3] : 0 }}>
          <ButtonsSection />
          <ChoiceSection />
          <W12Controls />
          <PriceSection />
          <CardsSection />
          <TrackingSection />
          <GarageSection />
          <DepartureTimeSection />
          <FieldsSection />
          <StatesSection />
          <TimersSection />
          <ConfirmSection />
          <VoiceSection />
          <SosSection />
          <TypeSection />
          <IconsSection />
          <Section wide title="دفتر رسم العزيزية" note="Joy J4: every dish drawing (three looks each) and every arch-topped scene. Open #sketchbook for this page alone.">
            <View style={{ gap: theme.space[6] }}>
              <SketchbookDishes />
              <SketchbookScenes />
            </View>
          </Section>
        </View>
      </View>
    </ScrollView>
  );
}

export function Gallery() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider theme="light" direction="rtl">
          <ToastProvider bottomOffset={32}>
            {typeof window !== 'undefined' && window.location.hash === '#stickers' ? (
              <ScrollView style={{ flex: 1, backgroundColor: 'transparent' }}>
                <StickersPage />
              </ScrollView>
            ) : typeof window !== 'undefined' && window.location.hash.startsWith('#sketchbook') ? (
              <ScrollView style={{ flex: 1 }}>
                <SketchbookPage dishSize={Number(window.location.hash.split('-')[1]) || 96} />
              </ScrollView>
            ) : (
              <Page />
            )}
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** W12 batch 1: switched-off toggles, the typed code cell, a segment with no valid pick, the connection strip. */
function W12Controls() {
  const theme = useTheme();
  const [a, setA] = useState(false);
  const [b, setB] = useState(true);
  const [code, setCode] = useState('48');
  return (
    <Section title="مفاتيح وشريط الاتصال" note="المفتاح المطفي واضح، خانة الرمز اللي تكتب بيها حبرية، والمقطع ما يختار شي إذا القيمة مو من الخيارات.">
      <Panel>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="body">إشعارات العروض</Text>
          <Toggle value={a} onValueChange={setA} accessibilityLabel="إشعارات العروض" testID="w12-toggle-off" />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="body">صوت التتبع</Text>
          <Toggle value={b} onValueChange={setB} accessibilityLabel="صوت التتبع" />
        </View>
        <OtpInput value={code} onChange={setCode} autoFocus accessibilityLabel="رمز التحقق" />
        <SegmentedControl value={'7' as '0' | '15'} onChange={() => undefined} options={[{ value: '0', label: ':00' }, { value: '15', label: ':15' }]} />
      </Panel>
      <View style={{ gap: theme.space[2] }}>
        <OfflineBanner kind="offline" />
        <OfflineBanner kind="unreachable" onRetry={() => undefined} />
        <OfflineBanner kind="stale" ageSeconds={40} />
        <OfflineBanner kind="back" />
      </View>
    </Section>
  );
}
