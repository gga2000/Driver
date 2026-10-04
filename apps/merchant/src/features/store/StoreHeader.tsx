import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { MerchantBalanceView, StoreStatusView } from '@driver/contracts';
import { Button, Skeleton, Text, useTheme, withAlpha, type StatusTone } from '@driver/ui';
import { MIcon, type MIconName } from '@/components/MIcon';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { clock12, minutesLeft } from '@/lib/time';
import { printerChipState, usePrinterSnapshot } from '@/features/print/runtime';

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
function OpenSwitch({ status, onPress }: { status: StoreStatusView; onPress: () => void }) {
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
        height: 40,
        paddingStart: theme.space[3],
        paddingEnd: 4,
        borderRadius: theme.radius.pill,
        backgroundColor: withAlpha(color, 0.12),
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text variant="label" weight={700} style={{ color }}>
        {label}
      </Text>
      <View style={{ width: 52, height: 32, borderRadius: 16, backgroundColor: color, padding: 3, alignItems: open ? 'flex-start' : 'flex-end' }}>
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#FFFFFF' }} />
      </View>
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
  const printer = usePrinterSnapshot();
  const chip = printerChipState(printer, status?.printer.state);

  const chips: ReactNode[] = [...(alerts ?? [])];
  if (status) {
    chips.push(
      status.busy.on && status.busy.until ? (
        <HeaderChip key="busy" testID="busy-chip" icon="flame" tone="warning" label={t('merchant.busy.chip_on', { minutes: minutesLeft(status.busy.until, now) })} onPress={onBusy} />
      ) : (
        <HeaderChip key="busy" testID="busy-chip" icon="flame" tone="neutral" label={t('merchant.busy.chip_off')} onPress={onBusy} />
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
        onPress={() => router.push('/printer')}
      />,
    );
  }

  const money =
    canSeeMoney && balance ? (
      <View testID="cash-balance" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], height: 48, paddingStart: theme.space[4], paddingEnd: 4, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
        <MIcon name="cash" size={20} color="successText" />
        <View style={{ flex: wide ? undefined : 1 }}>
          <Text variant="caption" color="textMuted" style={{ lineHeight: 16 }}>
            {t('merchant.money.balance_label')}
          </Text>
          <Text variant="label" weight={700} tabular color={balance.balanceIqd < 0 ? 'dangerText' : 'text'} style={{ lineHeight: 20 }}>
            {iqd(balance.balanceIqd, { locale })}
          </Text>
        </View>
        <Button testID="request-money" label={t('merchant.request_money')} size="sm" onPress={onCash} disabled={balance.balanceIqd <= 0} />
      </View>
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
  return (
    <View style={{ gap: theme.space[3], paddingTop: theme.space[2], paddingBottom: theme.space[3], borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[4] }}>
        <View style={{ flex: 1 }}>{name}</View>
        {status ? <OpenSwitch status={status} onPress={onToggleOpen} /> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2], paddingHorizontal: theme.space[4], alignItems: 'center' }}>
        {chips}
      </ScrollView>
      {money ? <View style={{ paddingHorizontal: theme.space[4] }}>{money}</View> : null}
    </View>
  );
}
