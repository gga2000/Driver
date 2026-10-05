import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { MerchantBalanceView, StoreStatusView } from '@driver/contracts';
import { Button, ModalSheet, Skeleton, Text, useTheme, withAlpha, type StatusTone } from '@driver/ui';
import { MIcon, type MIconName } from '@/components/MIcon';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { balanceState } from '@/features/money/logic';
import { clock12, minutesLeft } from '@/lib/time';
import { printerChipState, usePrinterSnapshot } from '@/features/print/runtime';
import { color as palette } from '@driver/design-tokens';

export interface StoreHeaderProps {
  storeName: string;
  status: StoreStatusView | undefined;
  balance: MerchantBalanceView | undefined;
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
  info: 'infoTint',
};
const TONE_FG: Record<StatusTone, 'text' | 'accentText' | 'successText' | 'warningText' | 'dangerText' | 'infoText'> = {
  neutral: 'text',
  accent: 'accentText',
  success: 'successText',
  warning: 'warningText',
  danger: 'dangerText',
  info: 'infoText',
};

/** A tappable status chip (40 px tall: easy to hit with a wet finger). */
export function HeaderChip({ icon, label, tone, onPress, testID, dot }: { icon: MIconName; label: string; tone: StatusTone; onPress: () => void; testID: string; dot?: boolean }) {
  const theme = useTheme();
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
        height: 40,
        paddingHorizontal: theme.space[3],
        borderRadius: theme.radius.pill,
        backgroundColor: theme.colors[TONE_BG[tone]],
        borderWidth: tone === 'neutral' ? 1 : 0,
        borderColor: theme.colors.border,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors[tone === 'danger' ? 'danger' : tone === 'success' ? 'success' : 'warning'] }} /> : null}
      <MIcon name={icon} size={18} color={TONE_FG[tone]} strokeWidth={2} />
      <Text variant="label" weight={600} color={TONE_FG[tone]} numberOfLines={1} tabular>
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
  const color = open ? theme.colors.success : paused ? theme.colors.warning : theme.colors.danger;
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
        height: compact ? 44 : 40,
        paddingStart: theme.space[3],
        paddingEnd: compact ? theme.space[3] : 4,
        borderRadius: theme.radius.pill,
        backgroundColor: withAlpha(color, 0.12),
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {compact ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} /> : null}
      <Text variant="label" weight={700} style={{ color }} numberOfLines={1}>
        {label}
      </Text>
      {compact ? null : (
        <View style={{ width: 52, height: 32, borderRadius: 16, backgroundColor: color, padding: 3, alignItems: open ? 'flex-start' : 'flex-end' }}>
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
export function StoreHeader({ storeName, status, balance, canSeeMoney, now, wide, onToggleOpen, onBusy, onCash, alerts }: StoreHeaderProps) {
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
  const money =
    canSeeMoney && balance && state ? (
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
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
        <MIcon name="store" size={22} color="accentText" />
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text variant="title" weight={700} numberOfLines={1}>
          {storeName}
        </Text>
        {status?.closed ? (
          <Text variant="caption" color="dangerText" numberOfLines={1}>
            {`${t(`merchant.close_reason.${status.closed.reason}` as const)} · ${clock12(status.closed.at)}`}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );

  if (wide) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[6], paddingVertical: theme.space[3], borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.bg }}>
        {name}
        {status ? <OpenSwitch status={status} onPress={onToggleOpen} /> : <Skeleton width={120} height={40} radius={20} />}
        {/* Chips scroll rather than squeeze the money pill when alert chips join them. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: theme.space[3], alignItems: 'center' }}>
          {chips}
        </ScrollView>
        {money}
      </View>
    );
  }
  // Phone (M-06): one 56-pt row — the store, open/closed, and "…" for busy mode, the printer and the
  // cash (which also lives on the Money tab). Alert chips ("الصوت طافي", "فاتك اليوم") get a second row
  // only while there is something to fix. Busy mode on reads under the store name.
  const busyOn = Boolean(status?.busy.on && status.busy.until);
  const needsLook = busyOn || chip === 'disconnected';
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.bg }}>
      <View testID="store-header-row" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 56, paddingHorizontal: theme.space[4] }}>
        <Pressable onPress={() => router.push('/stores')} accessibilityRole="button" style={{ flex: 1, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
            <MIcon name="store" size={20} color="accentText" />
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text variant="bodyStrong" weight={700} numberOfLines={1} style={{ lineHeight: 24 }}>
              {storeName}
            </Text>
            {busyOn && status?.busy.until ? (
              <Text variant="caption" color="warningText" weight={600} numberOfLines={1} tabular style={{ lineHeight: 16 }}>
                {t('merchant.busy.chip_on', { minutes: minutesLeft(status.busy.until, now) })}
              </Text>
            ) : status?.closed ? (
              <Text variant="caption" color="dangerText" numberOfLines={1} style={{ lineHeight: 16 }}>
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
          style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent' })}
        >
          <MIcon name="more" size={24} color="text" strokeWidth={2.4} />
          {needsLook ? <View style={{ position: 'absolute', top: 8, end: 8, width: 9, height: 9, borderRadius: 5, backgroundColor: chip === 'disconnected' ? theme.colors.danger : theme.colors.warning, borderWidth: 1.5, borderColor: theme.colors.bg }} /> : null}
        </Pressable>
      </View>
      {(alerts ?? []).length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2], paddingHorizontal: theme.space[4], paddingBottom: theme.space[2], alignItems: 'center' }}>
          {alerts}
        </ScrollView>
      ) : null}
      <ModalSheet visible={menu} onClose={() => setMenu(false)} title={storeName} testID="header-menu">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>{chips.slice((alerts ?? []).length)}</View>
        {money}
        <Button testID="header-switch-store" label={t('merchant.header.switch_store')} variant="secondary" icon="refresh" onPress={() => { setMenu(false); router.push('/stores'); }} />
      </ModalSheet>
    </View>
  );
}
