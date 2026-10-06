import { Platform, View } from 'react-native';
import Svg, { Circle, G, Text as SvgText } from 'react-native-svg';
import { RADAR_RINGS_M, type BoardOrder } from '@driver/contracts';
import { fontFace, fontFamily } from '@driver/design-tokens';
import { Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { arriving, distanceParts, incoming, radarLabelAt, radarPoint, radarRadius, RADAR_DOT_R as DOT_R, RADAR_LABEL_SIZE as LABEL_SIZE } from './radar';

/** Dots closer than this (px) carry one ticket label between them. */
const LABEL_GAP = 22;

/** The brand font for the ticket numbers on the rings (SVG text does not inherit it). */
const RADAR_FONT = Platform.OS === 'web' ? fontFamily.sans.join(', ') : fontFace[700];

/**
 * The courier radar (maps program SP7a, r1): every courier coming to this kitchen around it — rings
 * at 250 m, 1 km and 3 km, north up, a dot per courier with his ticket, green once he is about to
 * walk in — and beside it who is coming, how far, how many minutes and his pickup code. No map tiles:
 * light on a counter tablet, and the kitchen never gets a courier's coordinates.
 */
export function CourierRadarStrip({ orders, compact }: { orders: readonly BoardOrder[]; compact: boolean }) {
  const theme = useTheme();
  const t = useT();
  const list = incoming(orders);
  if (list.length === 0) return null;
  const size = compact ? 96 : 128;
  return (
    <View
      testID="courier-radar"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[4],
        marginHorizontal: compact ? theme.space[4] : theme.space[5],
        marginTop: theme.space[3],
        padding: theme.space[3],
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <Radar size={size} orders={list} />
      <View style={{ flex: 1, maxWidth: 560, gap: theme.space[2] }}>
        <Text variant="label" weight={700}>
          {t('merchant.radar.title')}
        </Text>
        {list.slice(0, compact ? 2 : 4).map((o) => (
          <RadarRow key={o.id} order={o} compact={compact} />
        ))}
      </View>
    </View>
  );
}

function Radar({ size, orders }: { size: number; orders: readonly BoardOrder[] }) {
  const theme = useTheme();
  const t = useT();
  const c = size / 2;
  const R = c - 8;
  const labels: Array<{ x: number; y: number }> = [];
  const dots = orders.map((o) => {
    const here = o.courier.state === 'arrived';
    const p = here ? { x: 0, y: 0 } : radarPoint(o.courier.distanceM ?? 0, o.courier.bearingDeg ?? 0);
    const x = c + p.x * R;
    const y = c + p.y * R;
    // Couriers bunched together share one label (the nearest one's); the list says who is who.
    const labelled = !here && !labels.some((l) => Math.hypot(l.x - x, l.y - y) < LABEL_GAP);
    if (labelled) labels.push({ x, y });
    return { o, here, near: arriving(o.courier), x, y, labelled };
  });
  return (
    // Physical directions (east is right) inside the RTL app.
    <View style={{ width: size, height: size, direction: 'ltr' }} accessibilityLabel={t('merchant.radar.label')}>
      <Svg width={size} height={size}>
        <Circle cx={c} cy={c} r={R} fill={theme.colors.surfaceSunken} />
        {RADAR_RINGS_M.map((m) => (
          <Circle key={m} cx={c} cy={c} r={R * radarRadius(m)} fill="none" stroke={theme.colors.border} strokeWidth={1} strokeDasharray={m === RADAR_RINGS_M[0] ? undefined : '3 4'} />
        ))}
        {/* The kitchen */}
        <Circle cx={c} cy={c} r={6} fill={theme.colors.text} />
        <Circle cx={c} cy={c} r={2.5} fill={theme.colors.surface} />
        {dots.map((d) => (
          <G key={d.o.id} testID={`radar-dot-${d.o.number}`}>
            {d.here ? <Circle cx={c} cy={c} r={11} fill="none" stroke={theme.colors.success} strokeWidth={2.5} /> : <Circle cx={d.x} cy={d.y} r={DOT_R} fill={d.near ? theme.colors.success : theme.colors.accent} stroke={theme.colors.surface} strokeWidth={2} />}
          </G>
        ))}
        {/* Ticket labels after every dot, so no later dot paints over a number; haloed, and kept inside the radar. */}
        {dots
          .filter((d) => d.labelled)
          .map((d) => {
            const at = radarLabelAt(d.x, d.y, size);
            return (
              <G key={`label-${d.o.id}`}>
                <SvgText x={at.x} y={at.y} fontSize={LABEL_SIZE} fontWeight="700" fontFamily={RADAR_FONT} fill={theme.colors.surfaceSunken} stroke={theme.colors.surfaceSunken} strokeWidth={3} strokeLinejoin="round" textAnchor="middle">
                  {d.o.number}
                </SvgText>
                <SvgText x={at.x} y={at.y} fontSize={LABEL_SIZE} fontWeight="700" fontFamily={RADAR_FONT} fill={theme.colors.text} textAnchor="middle">
                  {d.o.number}
                </SvgText>
              </G>
            );
          })}
      </Svg>
    </View>
  );
}

function RadarRow({ order, compact }: { order: BoardOrder; compact: boolean }) {
  const theme = useTheme();
  const t = useT();
  const c = order.courier;
  const here = c.state === 'arrived';
  const near = arriving(c);
  const dist = c.distanceM !== null && c.distanceM !== undefined ? distanceParts(c.distanceM) : null;
  const where = here ? t('merchant.radar.here') : [dist ? t(dist.key, { value: dist.value }) : null, c.etaMinutes ? t('merchant.radar.minutes', { minutes: c.etaMinutes }) : null].filter(Boolean).join(' · ');
  return (
    <View testID={`radar-row-${order.number}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
      <View style={{ paddingHorizontal: 6, height: 22, borderRadius: 6, justifyContent: 'center', backgroundColor: theme.colors.surfaceSunken }}>
        <Text variant="caption" weight={700} tabular style={{ lineHeight: 16 }}>
          #{order.number}
        </Text>
      </View>
      <Icon name={c.vehicleClass === 'tuktuk' ? 'tuktuk' : c.vehicleClass === 'bike' || !c.vehicleClass ? 'bike' : 'car'} size={16} color="textMuted" />
      <Text variant="footnote" weight={600} numberOfLines={1} style={{ flexShrink: 1 }}>
        {[c.firstName, compact ? null : c.plate].filter(Boolean).join(' · ') || '—'}
      </Text>
      <Text variant="footnote" weight={near ? 700 : 500} color={near ? 'successText' : 'textMuted'} tabular numberOfLines={1} style={{ marginStart: 'auto' }}>
        {where}
      </Text>
      {c.pickupCode ? <PickupCode code={c.pickupCode} small /> : null}
    </View>
  );
}

/** The 4-digit code the courier shows at the counter (maps program r4). */
export function PickupCode({ code, small = false, testID }: { code: string; small?: boolean; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      testID={testID}
      accessibilityLabel={`${t('merchant.radar.code')} ${code.split('').join(' ')}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: small ? 6 : theme.space[2], height: small ? 22 : 28, borderRadius: theme.radius.sm, borderWidth: 1.5, borderColor: theme.colors.text }}
    >
      {small ? null : (
        <Text variant="caption" color="textMuted" style={{ lineHeight: 16 }}>
          {t('merchant.radar.code')}
        </Text>
      )}
      <Text variant={small ? 'caption' : 'label'} weight={700} tabular style={{ letterSpacing: 2, lineHeight: small ? 16 : 20 }}>
        {code}
      </Text>
    </View>
  );
}
