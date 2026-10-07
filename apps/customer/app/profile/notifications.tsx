import { useEffect } from 'react';
import { AppState, Platform, Switch, View } from 'react-native';
import type { NotifyPreferences } from '@driver/contracts';
import { Button, Card, DataSaverCard, Icon, ListRow, Skeleton, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { useNotifyPreferences, usePushPermission, useSetNotifyPreferences } from '@/features/notify/usePush';
import { TimetablePicker } from '@/features/season/TimetablePicker';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { pushDevice } from '@/lib/push';
import { saveDataSaverPref } from '@/lib/data-saver-pref';
import { useTrackingSounds } from '@/lib/sound';

type PrefKey = keyof NotifyPreferences;

const PUSH_ROWS: ReadonlyArray<{
  key: PrefKey;
  icon: 'bag' | 'chat' | 'gift' | 'bell' | 'refresh';
  title: 'notify.pref.order_updates' | 'notify.pref.chat' | 'notify.pref.marketing' | 'notify.pref.dish_pots' | 'notify.pref.regular_trips';
  hint: 'notify.pref.order_updates_hint' | 'notify.pref.chat_hint' | 'notify.pref.marketing_hint' | 'notify.pref.dish_pots_hint' | 'notify.pref.regular_trips_hint';
}> = [
  { key: 'orderUpdates', icon: 'bag', title: 'notify.pref.order_updates', hint: 'notify.pref.order_updates_hint' },
  { key: 'chat', icon: 'chat', title: 'notify.pref.chat', hint: 'notify.pref.chat_hint' },
  // Joy h2: dishes the person follows, on the day a kitchen cooks them (on by default; following is the opt-in).
  { key: 'dishPots', icon: 'bell', title: 'notify.pref.dish_pots', hint: 'notify.pref.dish_pots_hint' },
  // Joy r5: «تأكد رحلتك؟» for his own regular trips (on by default; saving the trip is the opt-in).
  { key: 'regularTrips', icon: 'refresh', title: 'notify.pref.regular_trips', hint: 'notify.pref.regular_trips_hint' },
  { key: 'marketing', icon: 'gift', title: 'notify.pref.marketing', hint: 'notify.pref.marketing_hint' },
];

const CHANNEL_ROWS: ReadonlyArray<{ key: PrefKey; icon: 'receipt' | 'phone'; title: 'notify.pref.whatsapp_receipts' | 'notify.pref.sms_fallback'; hint: 'notify.pref.whatsapp_receipts_hint' | 'notify.pref.sms_fallback_hint' }> = [
  { key: 'whatsappReceipts', icon: 'receipt', title: 'notify.pref.whatsapp_receipts', hint: 'notify.pref.whatsapp_receipts_hint' },
  { key: 'smsFallback', icon: 'phone', title: 'notify.pref.sms_fallback', hint: 'notify.pref.sms_fallback_hint' },
];

/**
 * الإشعارات (customer spec §10 "notifications"): this phone's permission (with the way back from a
 * "no"), the person's switches — order updates, messages, offers (opt-in) on push; receipts on
 * WhatsApp and the SMS twin — and what can never be switched off (safety, codes). Saved per person
 * on the API (`notify.preferences`), so every phone and channel follows them.
 */
export default function NotificationSettings() {
  const theme = useTheme();
  const [sounds, setSounds] = useTrackingSounds();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const prefs = useNotifyPreferences();
  const save = useSetNotifyPreferences();
  const { permission, refresh, ask } = usePushPermission();

  // Coming back from the phone's settings: read the permission again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const toggle = (key: PrefKey, value: boolean) => {
    save.mutate(
      { [key]: value },
      {
        onSuccess: () => toast.show({ message: t('notify.settings.saved'), tone: 'success' }),
        onError: (err) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }),
      },
    );
  };

  const row = (r: { key: PrefKey; icon: 'bag' | 'chat' | 'gift' | 'bell' | 'receipt' | 'phone' | 'refresh'; title: Parameters<typeof t>[0]; hint: Parameters<typeof t>[0] }, divider: boolean) => (
    <ListRow
      key={r.key}
      testID={`pref-${r.key}`}
      leading={r.icon}
      title={t(r.title)}
      subtitle={t(r.hint)}
      chevron={false}
      divider={divider}
      trailing={
        prefs.data ? (
          <Switch
            accessibilityLabel={t(r.title)}
            value={prefs.data[r.key]}
            onValueChange={(v) => toggle(r.key, v)}
            trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
            {...(Platform.OS === 'web' ? { activeThumbColor: theme.colors.surface } : {})}
          />
        ) : (
          <Skeleton width={44} height={24} />
        )
      }
    />
  );

  return (
    <Screen edges={['bottom']} testID="notification-settings">
      <Text variant="footnote" color="textMuted">
        {t('notify.settings.intro')}
      </Text>

      <Card padding={4} tone={permission === 'granted' ? 'tint' : 'sunken'} testID="push-permission">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <Icon name="bell" size={22} color={permission === 'granted' ? 'accentText' : 'textMuted'} />
          <Text variant="label" style={{ flex: 1 }}>
            {t(permission === 'granted' ? 'notify.settings.system_on' : permission === 'denied' ? 'notify.settings.system_off' : 'notify.settings.turn_on')}
          </Text>
          {permission === 'granted' ? (
            <Icon name="check" size={22} color="accentText" />
          ) : permission === 'denied' ? (
            <Button size="sm" variant="secondary" label={t('notify.settings.open_system')} onPress={() => void pushDevice.openSettings()} />
          ) : permission === 'undetermined' ? (
            <Button testID="push-turn-on" size="sm" label={t('notify.preprompt.allow')} onPress={() => void ask()} />
          ) : null}
        </View>
      </Card>

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('notify.settings.section_push')} />
        <Card elevation={0} padding={0}>
          {PUSH_ROWS.map((r, i) => row(r, i < PUSH_ROWS.length - 1))}
        </Card>
      </View>

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('notify.settings.section_channels')} />
        <Card elevation={0} padding={0}>
          {CHANNEL_ROWS.map((r, i) => row(r, i < CHANNEL_ROWS.length - 1))}
        </Card>
      </View>

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('notify.settings.section_in_app')} />
        <Card elevation={0} padding={0}>
          <ListRow
            testID="pref-tracking-sounds"
            leading="volume"
            title={t('notify.settings.tracking_sounds')}
            subtitle={t('notify.settings.tracking_sounds_hint')}
            chevron={false}
            trailing={
              <Switch
                accessibilityLabel={t('notify.settings.tracking_sounds')}
                value={sounds}
                onValueChange={setSounds}
                trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
                {...(Platform.OS === 'web' ? { activeThumbColor: theme.colors.surface } : {})}
              />
            }
          />
        </Card>
        {/* Maps program q2: low-data mode. */}
        <DataSaverCard onChange={(p) => void saveDataSaverPref(p)} />
      </View>

      {/* J6: the Ramadan timetable this person follows (iftar and suhoor in the app). */}
      <TimetablePicker />

      <Card elevation={0} padding={0}>
        <ListRow leading="shield" title={t('notify.pref.safety')} subtitle={t('notify.pref.safety_hint')} chevron={false} trailing={<Icon name="check" size={20} color="accentText" />} />
      </Card>

      <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'flex-start' }}>
        <Icon name="clock" size={16} color="textMuted" />
        <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
          {t('notify.settings.quiet')}
        </Text>
      </View>
    </Screen>
  );
}
