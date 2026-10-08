import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { PrinterState } from '@driver/contracts';
import { Button, Icon, Text, useTheme, withAlpha } from '@driver/ui';
import { MIcon, type MIconName } from '@/components/MIcon';
import { useT } from '@/lib/i18n';
import type { TKey } from '@/lib/i18n-core';
import { useLayout } from '@/lib/layout';

type RowState = 'ready' | 'pending' | 'problem';

function CheckRow({ icon, title, hint, state, testID }: { icon: MIconName; title: string; hint: string; state: RowState; testID: string }) {
  const theme = useTheme();
  const tint = state === 'ready' ? theme.colors.successTint : state === 'problem' ? theme.colors.dangerTint : theme.colors.accentTint;
  const fg = state === 'ready' ? 'successText' : state === 'problem' ? 'dangerText' : 'accentText';
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[4], padding: theme.space[4], minHeight: 76, borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
      <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
        <MIcon name={icon} size={24} color={fg} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" style={{ fontSize: 16 }}>
          {title}
        </Text>
        <Text variant="footnote" color={state === 'problem' ? 'dangerText' : 'textMuted'}>
          {hint}
        </Text>
      </View>
      {state === 'ready' ? (
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.success, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={18} color="surface" strokeWidth={2.6} />
        </View>
      ) : null}
    </View>
  );
}

const PRINTER_HINT: Record<PrinterState | 'preview', TKey> = {
  connected: 'merchant.printer.chip_connected',
  disconnected: 'merchant.printer.chip_disconnected',
  not_set_up: 'merchant.printer.chip_not_set_up',
  preview: 'merchant.printer.chip_preview',
};

/**
 * "يلا نبدأ الشغل" (signature S-M1): over the board at the start of the day and after a reload. Three
 * checks — the sound (the tap unlocks it and plays the chime), the screen staying on, the printer —
 * and one big "ابدأ الشغل". Orders already waiting are counted on the button.
 *
 * Step 6 (y3): when the app comes back during today's shift (a power cut, a restart) it reads
 * «رجعت الكهرباء؟ التابلت طفى 6 دقايق»: the sound, the net and the printer, then «كمّل».
 */
export function ShiftGate({ waiting, soundOn, printer, onStart, back = null, online = true }: { waiting: number; soundOn: boolean; printer: PrinterState | 'preview'; onStart: () => Promise<void>; back?: { offMinutes: number } | null; online?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const { wide } = useLayout();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      await onStart();
    } finally {
      setBusy(false);
    }
  };
  const label = back
    ? waiting === 0
      ? t('merchant.shift.back_go')
      : waiting === 1
        ? t('merchant.shift.back_go_one')
        : t('merchant.shift.back_go_many', { count: waiting })
    : waiting === 0
      ? t('merchant.shift.start')
      : waiting === 1
        ? t('merchant.shift.start_one')
        : t('merchant.shift.start_many', { count: waiting });
  const title = !back ? t('merchant.shift.title') : back.offMinutes >= 1 ? t('merchant.shift.back_title') : t('merchant.shift.back_title_quick');
  const body = !back ? t('merchant.shift.body') : back.offMinutes >= 1 ? t('merchant.shift.back_body', { duration: t('merchant.pass.minutes', { minutes: back.offMinutes }) }) : t('merchant.shift.back_body_quick');
  return (
    <View testID="shift-gate" accessibilityViewIsModal style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, zIndex: 20, backgroundColor: withAlpha(theme.colors.text, 0.42), justifyContent: wide ? 'center' : 'flex-end', alignItems: 'center', padding: wide ? theme.space[6] : 0 }}>
      <Animated.View
        entering={theme.reduceMotion ? undefined : FadeInDown.duration(220)}
        style={{ width: '100%', maxWidth: wide ? 560 : undefined, backgroundColor: theme.colors.bg, borderRadius: theme.radius['2xl'], borderBottomStartRadius: wide ? theme.radius['2xl'] : 0, borderBottomEndRadius: wide ? theme.radius['2xl'] : 0, padding: theme.space[5], paddingBottom: theme.space[6], gap: theme.space[4], shadowColor: theme.colors.shadow, shadowOpacity: 0.2, shadowRadius: 30, shadowOffset: { width: 0, height: 10 }, elevation: 12 }}
      >
        <View style={{ gap: theme.space[1] }}>
          <Text variant="heading" accessibilityRole="header" testID={back ? 'power-back' : undefined}>
            {title}
          </Text>
          <Text variant="body" color="textMuted">
            {body}
          </Text>
        </View>
        <View style={{ gap: theme.space[2] }}>
          <CheckRow testID="shift-sound" icon="volume" title={t('merchant.shift.sound')} hint={soundOn ? t('merchant.shift.sound_hint') : t('merchant.shift.sound_off')} state="pending" />
          {back ? (
            <CheckRow testID="shift-net" icon={online ? 'wifi' : 'wifi-off'} title={t('merchant.shift.net')} hint={online ? t('merchant.shift.net_ok') : t('merchant.shift.net_off')} state={online ? 'ready' : 'problem'} />
          ) : (
            <CheckRow testID="shift-screen" icon="screen" title={t('merchant.shift.screen')} hint={t('merchant.shift.screen_hint')} state="pending" />
          )}
          <CheckRow testID="shift-printer" icon="printer" title={t('merchant.shift.printer')} hint={t(PRINTER_HINT[printer])} state={printer === 'connected' ? 'ready' : printer === 'disconnected' ? 'problem' : 'pending'} />
        </View>
        <Button testID="shift-start" label={label} size="lg" fullWidth haptic="medium" loading={busy} onPress={() => void start()} />
      </Animated.View>
    </View>
  );
}
