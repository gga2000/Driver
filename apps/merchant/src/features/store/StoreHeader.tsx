import { router } from 'expo-router';
import { createContext, isValidElement, useContext, useState, type ReactNode } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import type { MerchantBalanceView, MoneyHeadline, StoreStatusView } from '@driver/contracts';
import { Button, ModalSheet, Skeleton, Text, useTheme, withAlpha, type StatusTone } from '@driver/ui';
import { MIcon, type MIconName } from '@/components/MIcon';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { balanceState, moneyPill } from '@/features/money/logic';
import { clock12, minutesLeft } from '@/lib/time';
import { printerChipState, usePrinterSnapshot } from '@/features/print/runtime';
import { color as palette } from '@driver/design-tokens';
import { COUNTER } from '@/lib/counter';
import { chipsFitInline } from './header-fit';

export interface StoreHeaderProps {
  storeName: string;
  status: StoreStatusView | undefined;
  balance: MerchantBalanceView | undefined;
  /** S-M5: the server's one-line money pill (owners); falls back to `balance` while it loads. */
  headline?: MoneyHeadline | undefined;
  canSeeMoney: boolean;
  now: number;
  wide: boolean;
  onToggleOpen: () => void;
  onBusy: () => void;
  onCash: () => void;
  /** Chips that must be seen first ("الصوت طافي", "فاتك اليوم: 2"): before busy and printer. */
  alerts?: ReactNode[];
}

const TONE_BG: Record<StatusTone, 'surfaceSunken' | 'accentTint' | 'successTint' | 'warningTint' | 'dangerTint' | 'infoTint'> = {
  neutral: 'surfaceSunken',
  accent: 'accentTint',
  success: 'successTint',
  warning: 'warningTint',
  danger: 'dangerTint',
  info: 'surfaceSunken', // no blue on the counter
};
const TONE_FG: Record<StatusTone, 'text' | 'accentText' | 'successText' | 'warningText' | 'dangerText' | 'infoText'> = {
  neutral: 'text',
  accent: 'accentText',
  success: 'successText',
  warning: 'warningText',
  danger: 'dangerText',
  info: 'text',
};

/**
 * True inside the date-brown status bar (the counter, redesign step 1): chips there draw for a dark
 * ground. The phone's "…" sheet sits outside it, so the same chips draw light there.
 */
const OnBar = createContext(false);

/** Chip colours on the date bar: neutral chips lift on `dateRaised`, busy mode is gold, the rest keep their tints. */
function barChip(tone: StatusTone): { bg: string; fg: string; edge: string } | null {
  if (tone === 'neutral') return { bg: COUNTER.dateRaised, fg: COUNTER.onDate, edge: COUNTER.dateEdge };
  if (tone === 'warning') return { bg: COUNTER.busy, fg: COUNTER.onBusy, edge: COUNTER.busy };
  return null;
}

/**
 * A tappable status chip (40 px tall: easy to hit with a wet finger). Never wider than its row: on a
 * narrow phone a long label ("خلّي الشاشة شاعلة من إعدادات التابلت") wraps to a second line instead
 * of running off the edge.
 */
export function HeaderChip({ icon, label, tone, onPress, testID, dot }: { icon: MIconName; label: string; tone: StatusTone; onPress: () => void; testID: string; dot?: boolean }) {
  const theme = useTheme();
  const bar = useContext(OnBar) ? barChip(tone) : null;
  return (
    <Pressable hitSlop={2}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        minHeight: 44,
        maxWidth: '100%',
        paddingVertical: 2,
        paddingHorizontal: theme.space[3],
        borderRadius: theme.radius.pill,
        backgroundColor: bar ? bar.bg : theme.colors[TONE_BG[tone]],
        borderWidth: tone === 'neutral' ? 1 : 0,
        borderColor: bar ? bar.edge : theme.colors.border,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors[tone === 'danger' ? 'danger' : tone === 'success' ? 'success' : 'warning'] }} /> : null}
      <MIcon name={icon} size={18} color={bar ? bar.fg : TONE_FG[tone]} strokeWidth={2} />
      <Text variant="label" weight={600} color={bar ? bar.fg : TONE_FG[tone]} numberOfLines={2} tabular style={{ flexShrink: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Open / closed switch: a big pill with a knob — green open, red closed, amber during a pause. */
function OpenSwitch({ status, onPress, compact = false }: { status: StoreStatusView; onPress: () => void; compact?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const paused = status.pause !== null && status.closed === null;
  const open = status.open;
  // On the date bar: solid green open, solid red closed, gold during a pause; the words stay readable in the sun.
  const color = open ? COUNTER.ready : paused ? COUNTER.busy : COUNTER.late;
  const ink = paused ? COUNTER.onBusy : COUNTER.onDate;
  const label = open ? t('merchant.status.open') : paused ? t('merchant.status.paused', { time: status.pause!.until }) : t('merchant.status.closed');
  return (
    <Pressable hitSlop={2}
      testID="store-open-toggle"
      accessibilityRole="switch"
      accessibilityState={{ checked: open }}
      accessibilityLabel={label}
      disabled={paused}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        height: 44,
        paddingStart: theme.space[3],
        paddingEnd: compact ? theme.space[3] : 6,
        borderRadius: theme.radius.pill,
        backgroundColor: color,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {compact ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ink }} /> : null}
      <Text variant="label" weight={700} style={{ color: ink }} numberOfLines={1}>
        {label}
      </Text>
      {compact ? null : (
        <View style={{ width: 52, height: 32, borderRadius: 16, backgroundColor: withAlpha(COUNTER.date, 0.35), padding: 3, alignItems: open ? 'flex-start' : 'flex-end' }}>
          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: palette.neutral[0] }} />
        </View>
      )}
    </Pressable>
  );
}

/**
 * The board's status bar: store name, open/closed, busy mode (with countdown), printer marker, and —
 * for owners — the live cash balance with "اطلب فلوسك". One row on a tablet; two on a phone.
 */
/**
 * S-M5 · money you can read in one line: "إلك 87,500 دينار · توصلك الليلة ويا الدليفري" with "اطلب
 * فلوسك"; "عليك 4,250 دينار عمولة · تنخصم من الجاية" on the warning tint; "فلوسك جاية قبل 9:40 م".
 * Amounts and times are the server's; a tap on anything but the button opens the Money screen.
 */
export function MoneyLine({ headline, wide, onRequest, onOpen }: { headline: MoneyHeadline; wide: boolean; onRequest: () => void; onOpen: () => void }) {
  const theme = useTheme();
  const t = useT();
  const p = moneyPill(headline);
  const bg = p.tone === 'warning' ? theme.colors.warningTint : p.tone === 'success' ? theme.colors.successTint : theme.colors.surface;
  const edge = p.tone === 'warning' ? theme.colors.warning : p.tone === 'success' ? theme.colors.success : theme.colors.border;
  const fg = p.tone === 'warning' ? 'warningText' : p.tone === 'success' ? 'successText' : 'text';
  const main = t(p.main.key, {
    ...(p.main.amountIqd !== undefined ? { amount: amountParam(p.main.amountIqd) } : {}),
    ...(p.main.time ? { time: clock12(p.main.time) } : {}),
  });
  const sub = p.sub ? t(p.sub) : null;
  return (
    <View
      testID="cash-balance"
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 48, paddingStart: theme.space[4], paddingEnd: p.action === 'request' ? 4 : theme.space[4], borderRadius: theme.radius.pill, backgroundColor: bg, borderWidth: 1, borderColor: edge, flexShrink: 1 }}
    >
      <Pressable
        testID="money-line"
        accessibilityRole="button"
        accessibilityLabel={sub ? `${main} · ${sub}` : main}
        accessibilityHint={t('merchant.moneypill.open_a11y')}
        onPress={onOpen}
        style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 44, flexShrink: 1 }}
      >
        <MIcon name={p.tone === 'success' ? 'clock' : 'cash'} size={20} color={p.tone === 'neutral' ? 'successText' : fg} />
        {wide ? (
          // Tablet (m1a): the amount on top, how it reaches him underneath — the pill stays narrow
          // enough for the status chips to keep their room in the bar.
          <View style={{ flexShrink: 1 }}>
            <Text variant="label" weight={700} tabular color={fg} numberOfLines={1} style={{ lineHeight: 20 }}>
              {main}
            </Text>
            {sub ? (
              <Text variant="caption" weight={500} color={p.tone === 'neutral' ? 'textMuted' : fg} numberOfLines={1} style={{ lineHeight: 16 }}>
                {sub}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text variant="label" tabular numberOfLines={2} style={{ flexShrink: 1, lineHeight: 20 }}>
            <Text variant="label" weight={700} tabular color={fg}>
              {main}
            </Text>
            {sub ? (
              <Text variant="label" weight={500} color={p.tone === 'neutral' ? 'textMuted' : fg}>
                {` · ${sub}`}
              </Text>
            ) : null}
          </Text>
        )}
      </Pressable>
      {p.action === 'request' ? <Button testID="request-money" label={t('merchant.request_money')} size="sm" onPress={onRequest} /> : null}
    </View>
  );
}

/** The store name never takes more than this on a tablet (a long name truncates, the chips keep their room). */
const WIDE_NAME_MAX = 280;

function chipKey(node: ReactNode, i: number): string {
  return isValidElement(node) && node.key !== null ? String(node.key) : `chip-${i}`;
}

/**
 * Tablet status bar (m1a): one row — store, open switch, chips, money — while everything fits at its
 * natural width; otherwise the chips get a second row of their own and wrap there. Widths are measured
 * (onLayout), so a longer money line, a new alert chip or a narrower tablet never clips a chip.
 */
function WideBar({ name, openSwitch, chips, money }: { name: ReactNode; openSwitch: ReactNode; chips: ReactNode[]; money: ReactNode }) {
  const theme = useTheme();
  const padding = theme.space[6];
  const gap = theme.space[3];
  const [row, setRow] = useState(0);
  const [fixed, setFixed] = useState<{ name: number; open: number; money: number }>({ name: 0, open: 0, money: 0 });
  const [chipW, setChipW] = useState<Record<string, number>>({});
  const keys = chips.map(chipKey);
  const measureFixed = (k: 'name' | 'open' | 'money') => (e: LayoutChangeEvent) => {
    const w = Math.ceil(e.nativeEvent.layout.width);
    setFixed((f) => (f[k] === w ? f : { ...f, [k]: w }));
  };
  const measureChip = (k: string) => (e: LayoutChangeEvent) => {
    const w = Math.ceil(e.nativeEvent.layout.width);
    setChipW((c) => (c[k] === w ? c : { ...c, [k]: w }));
  };
  const inline = chipsFitInline({
    row,
    padding,
    gap,
    fixed: [fixed.name, fixed.open, ...(money ? [fixed.money] : [])],
    chips: keys.map((k) => chipW[k] ?? 0),
  });
  const wrapped = chips.map((c, i) => (
    <View key={keys[i]} onLayout={measureChip(keys[i]!)} style={{ flexShrink: inline ? 0 : 1, maxWidth: '100%' }}>
      {c}
    </View>
  ));
  return (
    <View
      testID="store-header"
      onLayout={(e) => setRow(Math.floor(e.nativeEvent.layout.width))}
      style={{ gap: theme.space[2], paddingHorizontal: padding, paddingVertical: theme.space[3], backgroundColor: COUNTER.date }}
    >
      <OnBar.Provider value={true}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap }}>
        <View onLayout={measureFixed('name')} style={{ maxWidth: WIDE_NAME_MAX, flexShrink: 0 }}>
          {name}
        </View>
        <View onLayout={measureFixed('open')}>{openSwitch}</View>
        {inline ? (
          <View testID="store-header-chips" style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap, overflow: 'hidden' }}>
            {wrapped}
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {money ? (
          <View onLayout={measureFixed('money')} style={{ flexShrink: 0 }}>
            {money}
          </View>
        ) : null}
      </View>
      {inline ? null : (
        <View testID="store-header-chips" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space[2] }}>
          {wrapped}
        </View>
      )}
      </OnBar.Provider>
    </View>
  );
}

export function StoreHeader({storeName, status, balance, headline, canSeeMoney, now, wide, onToggleOpen, onBusy, onCash, alerts }: StoreHeaderProps) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const [menu, setMenu] = useState(false);
  // On a phone these live in the "…" menu: close it before the busy sheet or "اطلب فلوسك" opens.
  const busyPress = () => {
    setMenu(false);
    onBusy();
  };
  const cashPress = () => {
    setMenu(false);
    onCash();
  };
  const printer = usePrinterSnapshot();
  const chip = printerChipState(printer, status?.printer.state);

  const chips: ReactNode[] = [...(alerts ?? [])];
  if (status) {
    chips.push(
      status.busy.on && status.busy.until ? (
        <HeaderChip key="busy" testID="busy-chip" icon="flame" tone="warning" label={t('merchant.busy.chip_on', { minutes: minutesLeft(status.busy.until, now) })} onPress={busyPress} />
      ) : (
        <HeaderChip key="busy" testID="busy-chip" icon="flame" tone="neutral" label={t('merchant.busy.chip_off')} onPress={busyPress} />
      ),
    );
    chips.push(
      <HeaderChip
        key="printer"
        testID="printer-chip"
        icon="printer"
        dot={chip === 'disconnected'}
        tone={chip === 'connected' ? 'success' : chip === 'disconnected' ? 'danger' : 'neutral'}
        label={
          chip === 'connected'
            ? t('merchant.printer.chip_connected')
            : chip === 'disconnected'
              ? t('merchant.printer.chip_disconnected')
              : chip === 'preview'
                ? t('merchant.printer.chip_preview')
                : t('merchant.printer.chip_not_set_up')
        }
        onPress={() => {
          setMenu(false);
          router.push('/printer');
        }}
      />,
    );
  }

  // M-07 / S-M5: the balance in one readable line. Positive: what Driver holds for him and "اطلب فلوسك".
  // Negative: "عليك 4,250 دينار عمولة · تنخصم من فلوسك الجاية" on the warning tint, no dead button (tap
  // opens the Money screen that explains it). Zero: says so, no button.
  const state = balance ? balanceState(balance.balanceIqd) : null;
  const openMoney = () => {
    setMenu(false);
    router.push('/money');
  };
  const money =
    canSeeMoney && headline ? (
      <MoneyLine headline={headline} wide={wide} onRequest={cashPress} onOpen={openMoney} />
    ) : canSeeMoney && balance && state ? (
      state.kind === 'owed' ? (
        <View testID="cash-balance" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], height: 48, paddingStart: theme.space[4], paddingEnd: 4, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
          <MIcon name="cash" size={20} color="successText" />
          <View style={{ flex: wide ? undefined : 1 }}>
            <Text variant="caption" color="textMuted" style={{ lineHeight: 16 }}>
              {t('merchant.money.pill_positive')}
            </Text>
            <Text variant="label" weight={700} tabular style={{ lineHeight: 20 }}>
              {iqd(balance.balanceIqd, { locale })}
            </Text>
          </View>
          <Button testID="request-money" label={t('merchant.request_money')} size="sm" onPress={cashPress} />
        </View>
      ) : (
        <Pressable
          testID="cash-balance"
          accessibilityRole="button"
          onPress={() => {
            setMenu(false);
            router.push('/money');
          }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 48, paddingHorizontal: theme.space[4], paddingVertical: 4, borderRadius: theme.radius.pill, backgroundColor: state.kind === 'owe' ? theme.colors.warningTint : theme.colors.surface, borderWidth: 1, borderColor: state.kind === 'owe' ? theme.colors.warning : theme.colors.border }}
        >
          <MIcon name="cash" size={20} color={state.kind === 'owe' ? 'warningText' : 'textMuted'} />
          <View style={{ flex: wide ? undefined : 1 }}>
            <Text variant="label" weight={700} tabular color={state.kind === 'owe' ? 'warningText' : 'text'} style={{ lineHeight: 20 }}>
              {state.kind === 'owe' ? t('merchant.money.pill_owe', { amount: amountParam(state.amountIqd) }) : t('merchant.money.pill_zero')}
            </Text>
            {state.kind === 'owe' ? (
              <Text variant="caption" color="warningText" style={{ lineHeight: 16 }}>
                {t('merchant.money.pill_owe_hint')}
              </Text>
            ) : null}
          </View>
        </Pressable>
      )
    ) : null;

  const name = (
    <Pressable onPress={() => router.push('/stores')} accessibilityRole="button" style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: COUNTER.dateRaised, alignItems: 'center', justifyContent: 'center' }}>
        <MIcon name="store" size={22} color={COUNTER.busy} />
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text variant="title" numberOfLines={1} style={[theme.face('display'), { color: COUNTER.onDate }]}>
          {storeName}
        </Text>
        {status?.closed ? (
          <Text variant="caption" numberOfLines={1} style={{ color: COUNTER.onDateLate }}>
            {`${t(`merchant.close_reason.${status.closed.reason}` as const)} · ${clock12(status.closed.at)}`}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );

  if (wide) {
    return (
      <WideBar name={name} openSwitch={status ? <OpenSwitch status={status} onPress={onToggleOpen} /> : <Skeleton width={120} height={40} radius={20} />} chips={chips} money={money} />
    );
  }
  // Phone (M-06): one 56-pt row — the store, open/closed, and "…" for busy mode, the printer and the
  // cash (which also lives on the Money tab). Alert chips ("الصوت طافي", "فاتك اليوم") get a second row
  // only while there is something to fix. Busy mode on reads under the store name.
  const busyOn = Boolean(status?.busy.on && status.busy.until);
  const needsLook = busyOn || chip === 'disconnected';
  return (
    <View style={{ backgroundColor: COUNTER.date }}>
      <OnBar.Provider value={true}>
      <View testID="store-header-row" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 56, paddingHorizontal: theme.space[4] }}>
        <Pressable onPress={() => router.push('/stores')} accessibilityRole="button" style={{ flex: 1, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: COUNTER.dateRaised, alignItems: 'center', justifyContent: 'center' }}>
            <MIcon name="store" size={20} color={COUNTER.busy} />
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text variant="bodyStrong" numberOfLines={1} style={[theme.face('display'), { lineHeight: 24, color: COUNTER.onDate }]}>
              {storeName}
            </Text>
            {busyOn && status?.busy.until ? (
              <Text variant="caption" weight={600} numberOfLines={1} tabular style={{ lineHeight: 16, color: COUNTER.busy }}>
                {t('merchant.busy.chip_on', { minutes: minutesLeft(status.busy.until, now) })}
              </Text>
            ) : status?.closed ? (
              <Text variant="caption" numberOfLines={1} style={{ lineHeight: 16, color: COUNTER.onDateLate }}>
                {t(`merchant.close_reason.${status.closed.reason}` as const)}
              </Text>
            ) : null}
          </View>
        </Pressable>
        {status ? <OpenSwitch status={status} onPress={onToggleOpen} compact /> : <Skeleton width={84} height={44} radius={22} />}
        <Pressable
          testID="header-more"
          accessibilityRole="button"
          accessibilityLabel={t('merchant.header.more')}
          onPress={() => setMenu(true)}
          style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? COUNTER.dateRaised : 'transparent' })}
        >
          <MIcon name="more" size={24} color={COUNTER.onDate} strokeWidth={2.4} />
          {needsLook ? <View style={{ position: 'absolute', top: 8, end: 8, width: 9, height: 9, borderRadius: 5, backgroundColor: chip === 'disconnected' ? COUNTER.onDateLate : COUNTER.busy, borderWidth: 1.5, borderColor: COUNTER.date }} /> : null}
        </Pressable>
      </View>
      {(alerts ?? []).length > 0 ? (
        // m3a: the alert chips wrap onto another line rather than scroll off the left edge.
        <View testID="store-header-alerts" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2], paddingHorizontal: theme.space[4], paddingBottom: theme.space[2], alignItems: 'center' }}>
          {alerts}
        </View>
      ) : null}
      </OnBar.Provider>
      <ModalSheet visible={menu} onClose={() => setMenu(false)} title={storeName} testID="header-menu">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>{chips.slice((alerts ?? []).length)}</View>
        {money}
        <Button testID="header-switch-store" label={t('merchant.header.switch_store')} variant="secondary" icon="refresh" onPress={() => { setMenu(false); router.push('/stores'); }} />
      </ModalSheet>
    </View>
  );
}
