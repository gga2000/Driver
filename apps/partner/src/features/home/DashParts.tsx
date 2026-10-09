import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PartnerCash, VehicleClass } from '@driver/contracts';
import { partnerDash } from '@driver/design-tokens';
import { Avatar, Button, Icon, Text, usePulse, useTheme, type IconName } from '@driver/ui';
import { HandoverSheet } from '@/features/account/HandoverSheet';
import { driversKey, inZone, jobsKey, VEHICLE_ICON, VEHICLE_KEY, waitingKey } from '@/features/work/logic';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { cashLoudness, type DashState, type WorkHint } from './logic';

/** The page column on tablets and the web. */
export const DASH_MAX_WIDTH = 520;

/** «14,000» huge, «دينار» beside it: the number is the point (h1). */
function BigMoney({ iqd, color, unit = color, testID }: { iqd: number; color: string; unit?: string; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }} accessible accessibilityLabel={t('partner.dash_today') + ' ' + amountParam(iqd) + ' ' + t('partner.dash_iqd')}>
      <Text variant="numeralLg" color={color} tabular style={{ fontSize: 58, lineHeight: 70, letterSpacing: -1 }}>
        {amountParam(iqd)}
      </Text>
      <Text variant="title" weight={700} color={unit}>
        {t('partner.dash_iqd')}
      </Text>
    </View>
  );
}

/**
 * The top of home (h1, h3, h10). Waiting: calm cream — «هلا حيدر · دراجة», today's money huge, the
 * jobs line. Working: the whole top turns saffron with a breathing dot, so he can tell from a metre
 * away. No internet: ink, saying orders can't reach him.
 */
export function DashTop({
  state,
  name,
  vehicle,
  earningsIqd,
  jobs,
  sinceClock,
  cutTitle,
  cutBody,
  canDrive,
}: {
  state: DashState;
  name: string | null;
  vehicle: VehicleClass;
  earningsIqd: number | null;
  jobs: number;
  /** «7:42» — when this shift started; null while waiting. */
  sinceClock: string | null;
  cutTitle: string;
  cutBody: string;
  canDrive: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const dash = partnerDash[theme.scheme === 'dark' ? 'ember' : 'sun'];
  const pulse = usePulse(state === 'working');
  const working = state === 'working';
  const cut = state === 'cut';
  // The top's ink: dash colours on the working and no-internet tops (deep ember at night), theme text when waiting.
  const ink = cut ? dash.onOffline : working ? dash.onWorking : theme.colors.text;
  const muted = cut ? dash.onOfflineMuted : working ? dash.onWorkingMuted : theme.colors.textMuted;
  const [w, setW] = useState(0);
  const [h, setH] = useState(0);

  const greeting = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
      <Avatar name={name ?? undefined} {...(name ? {} : { icon: 'user' as const })} size={44} tone="accent" />
      <View style={{ flex: 1 }}>
        <Text variant="label" weight={700} color={ink} testID="dash-hello">
          {name ? t('partner.dash_hello', { name }) : t('partner.dash_hello_noname')}
        </Text>
        {canDrive ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} testID="vehicle-chip">
            <Icon name={VEHICLE_ICON[vehicle]} size={15} color={muted} strokeWidth={2} />
            <Text variant="caption" weight={600} color={muted}>
              {t(VEHICLE_KEY[vehicle])}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <View
      testID="dash-top"
      onLayout={(e) => {
        setW(e.nativeEvent.layout.width);
        setH(e.nativeEvent.layout.height);
      }}
      style={{
        paddingTop: insets.top + theme.space[3],
        paddingBottom: working || cut ? theme.space[6] : theme.space[4],
        paddingHorizontal: theme.space[5],
        borderBottomLeftRadius: working || cut ? 28 : 0,
        borderBottomRightRadius: working || cut ? 28 : 0,
        backgroundColor: cut ? dash.offline : working ? dash.working[1] : theme.colors.bg,
        overflow: 'hidden',
        gap: theme.space[3],
      }}
    >
      {working && w > 0 ? (
        <Svg width={w} height={h} style={{ position: 'absolute', top: 0, start: 0 }} pointerEvents="none">
          <Defs>
            <LinearGradient id="dash-working" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={dash.working[0]} />
              <Stop offset="1" stopColor={dash.working[1]} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={w} height={h} fill="url(#dash-working)" />
        </Svg>
      ) : null}
      <View style={{ width: '100%', maxWidth: DASH_MAX_WIDTH, alignSelf: 'center', gap: theme.space[3] }}>
        {greeting}
        {canDrive && (working || cut) ? (
          <View testID="home-status" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
              {working ? <Animated.View style={[{ position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: dash.workingMark }, pulse]} /> : null}
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: cut ? theme.colors.danger : dash.workingMark }} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="title" weight={700} color={ink} accessibilityLabel={working && sinceClock ? t('partner.dash_working_a11y', { time: sinceClock }) : undefined}>
                {cut ? cutTitle : t('partner.dash_working')}
              </Text>
              <Text variant="footnote" weight={600} color={muted} tabular>
                {cut ? cutBody : sinceClock ? t('partner.dash_working_since', { time: sinceClock }) : t('partner.online_body')}
              </Text>
            </View>
          </View>
        ) : null}
        {earningsIqd == null ? null : (
          <View style={{ gap: 0 }}>
            {!working && !cut ? (
              <Text variant="label" weight={600} color="textMuted">
                {t('partner.dash_today')}
              </Text>
            ) : null}
            <BigMoney iqd={earningsIqd} color={working ? dash.workingMark : ink} unit={ink} testID="today-pill" />
            {/* «ما اشتغلت اليوم بعد» only with nothing earned: الرجعة seats and خطوط runs earn without job counts. */}
            {jobs > 0 || earningsIqd === 0 ? (
              <Text variant="footnote" weight={600} color={muted} tabular>
                {jobs > 0 ? t(jobsKey(jobs), { n: jobs }) : t('partner.today_zero')}
              </Text>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}

/** A dashboard card: white, a firm warm edge, generous radius (the slip's cousin). */
export function DashCard({ children, tone = 'plain', testID }: { children: ReactNode; tone?: 'plain' | 'saffron' | 'danger'; testID?: string }) {
  const theme = useTheme();
  const bg = tone === 'saffron' ? partnerDash[theme.scheme === 'dark' ? 'ember' : 'sun'].cashNear : tone === 'danger' ? theme.colors.dangerTint : theme.colors.surface;
  const edge = tone === 'saffron' ? theme.colors.accent : tone === 'danger' ? theme.colors.danger : theme.colors.border;
  return (
    <View testID={testID} style={{ backgroundColor: bg, borderWidth: 1.5, borderColor: edge, borderRadius: 20, padding: theme.space[4], gap: theme.space[3] }}>
      {children}
    </View>
  );
}

/**
 * h4/h5: «الشغل هسة بشارع 30 · 1.2 كم» with «روح هناك» (his navigation app) and «وريني الخريطة».
 * When he's already there it says so instead of sending him somewhere.
 */
export function WorkHintCard({ hint, onGo, onMap }: { hint: WorkHint; onGo: () => void; onMap: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <DashCard testID="demand-row">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="flag" size={20} color="accentText" strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="label" weight={700}>
            {t('partner.hint_title', { where: inZone(hint.zoneId, t) })}
          </Text>
          <Text variant="caption" color="textMuted" tabular>
            {hint.here ? t('partner.hint_here') : `${t(waitingKey(hint.waiting), { n: hint.waiting })} · ${t(driversKey(hint.drivers), { n: hint.drivers })}`}
          </Text>
        </View>
        {hint.km != null && !hint.here ? (
          <View style={{ backgroundColor: theme.colors.accentTint, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
            <Text variant="caption" weight={700} color="accentText" tabular>
              {t('partner.hint_km', { km: hint.km.toFixed(1) })}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
        {!hint.here ? <Button testID="hint-go" label={t('partner.hint_go')} icon="location-arrow" variant="ink" onPress={onGo} style={{ flex: 1, minHeight: 48 }} /> : null}
        <Button testID="hint-map" label={t('partner.hint_map')} variant="secondary" onPress={onMap} style={{ flex: 1, minHeight: 48 }} />
      </View>
    </DashCard>
  );
}

/**
 * h7 + b10: cash in hand as one quiet line while nothing is wrong, a saffron card near the cap, red
 * when offers stopped. Nothing at all when he holds nothing.
 */
export function CashLine({ cash }: { cash: PartnerCash }) {
  const theme = useTheme();
  const t = useT();
  const [open, setOpen] = useState(false);
  const loud = cashLoudness(cash);
  if (loud === 'none') return null;
  const sheet = <HandoverSheet visible={open} onClose={() => setOpen(false)} heldIqd={cash.heldIqd} owedIqd={cash.owedIqd} />;
  if (loud === 'quiet') {
    return (
      <Pressable testID="cash-bar" accessibilityRole="button" onPress={() => setOpen(true)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingHorizontal: theme.space[1] }}>
        <Icon name="cash" size={18} color="textMuted" strokeWidth={2} />
        <Text variant="footnote" weight={600} color="textMuted" tabular style={{ flex: 1 }}>
          {t('partner.cash_quiet', { held: amountParam(cash.heldIqd), cap: amountParam(cash.capIqd) })}
        </Text>
        {sheet}
      </Pressable>
    );
  }
  const blocked = loud === 'blocked';
  return (
    <DashCard tone={blocked ? 'danger' : 'saffron'} testID="cash-bar">
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
        <Icon name="cash" size={22} color={blocked ? 'dangerText' : 'accentText'} strokeWidth={2.2} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={700} color={blocked ? 'dangerText' : 'text'}>
            {t(blocked ? 'partner.cash_blocked_title' : 'partner.cash_near_title')}
          </Text>
          <Text variant="footnote" color="text" tabular>
            {blocked
              ? t('partner.cash_blocked_body', { owed: amountParam(cash.owedIqd) })
              : t('partner.cash_near_body', { owed: amountParam(cash.owedIqd), left: amountParam(cash.remainingIqd) })}
          </Text>
        </View>
      </View>
      <Button testID="cash-where" label={t('partner.cash_where')} variant={blocked ? 'primary' : 'secondary'} size="sm" onPress={() => setOpen(true)} style={{ alignSelf: 'flex-start', minHeight: 44 }} />
      {sheet}
    </DashCard>
  );
}

/** h9: the most urgent "needs you" card, and «+2 شغلات بعد» that unfolds the rest. */
export function AttentionStack({ items }: { items: { key: string; node: ReactNode }[] }) {
  const theme = useTheme();
  const t = useT();
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const rest = items.length - 1;
  return (
    <View testID="attention" style={{ gap: theme.space[2] }}>
      {items[0]!.node}
      {open ? items.slice(1).map((i) => <View key={i.key}>{i.node}</View>) : null}
      {rest > 0 ? (
        <Pressable
          testID="attention-more"
          accessibilityRole="button"
          onPress={() => setOpen((o) => !o)}
          style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.space[3], borderRadius: 999, backgroundColor: theme.colors.surfaceSunken }}
        >
          <Text variant="caption" weight={700} tabular>
            {open ? t('partner.attention_less') : rest === 1 ? t('partner.attention_more_one') : t('partner.attention_more', { n: rest })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Small square icon tile used by the mode cards (garage board, today's run). */
export function ModeTile({ icon, testID, title, body, cta, onPress }: { icon: IconName; testID: string; title: string; body: string; cta: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.985 : 1 }] })}>
      <DashCard>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: theme.colors.inverse, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={icon} size={22} color="onInverseCaution" strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="label" weight={700}>
              {title}
            </Text>
            <Text variant="caption" color="textMuted" numberOfLines={2}>
              {body}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Text variant="caption" weight={700} color="accentText">
              {cta}
            </Text>
            <Icon name="chevron-forward" size={16} color="accentText" strokeWidth={2.4} />
          </View>
        </View>
      </DashCard>
    </Pressable>
  );
}
