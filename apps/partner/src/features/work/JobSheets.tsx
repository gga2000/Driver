import { Pressable, View } from 'react-native';
import { Button, Icon, ModalSheet, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { NAV_APPS, type NavApp } from './nav';

const NAV_NAME: Record<NavApp, 'partner.nav_google' | 'partner.nav_waze'> = { google: 'partner.nav_google', waze: 'partner.nav_waze' };

/**
 * "وصلت؟" (maps program d4): he has stood inside the stop's 60 m for 10 s. One big button arrives (the
 * same action as the job button); "مو بعد" closes it until he leaves and comes back.
 */
export function ArriveSheet({ visible, place, busy, onArrive, onNotYet }: { visible: boolean; place: string; busy: boolean; onArrive: () => void; onNotYet: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <ModalSheet
      visible={visible}
      onClose={onNotYet}
      title={t('partner.arrive_ask_title')}
      subtitle={place}
      locked={busy}
      testID="arrive-sheet"
      footer={
        <View style={{ gap: theme.space[2] }}>
          <Button label={t('partner.arrive_ask_yes')} icon="check" size="lg" haptic="success" loading={busy} onPress={onArrive} testID="arrive-yes" />
          <Button label={t('partner.arrive_ask_not_yet')} variant="ghost" onPress={onNotYet} disabled={busy} testID="arrive-not-yet" />
        </View>
      }
    >
      <Text variant="body" color="textMuted">
        {t('partner.arrive_ask_body')}
      </Text>
    </ModalSheet>
  );
}

/** Google Maps or Waze (maps program d3): asked on the first "الخريطة", changeable in the account tab. */
export function NavChooser({ visible, current, onPick, onClose }: { visible: boolean; current: NavApp | null; onPick: (app: NavApp) => void; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <ModalSheet visible={visible} onClose={onClose} title={t('partner.nav_choose_title')} subtitle={t('partner.nav_choose_body')} testID="nav-chooser">
      <View style={{ gap: theme.space[2] }}>
        {NAV_APPS.map((app) => (
          <Pressable
            key={app}
            accessibilityRole="radio"
            aria-checked={current === app}
            onPress={() => onPick(app)}
            testID={`nav-${app}`}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[3],
              minHeight: 56,
              paddingHorizontal: theme.space[4],
              borderRadius: theme.radius.lg,
              borderWidth: current === app ? 2 : 1,
              borderColor: current === app ? theme.colors.accent : theme.colors.border,
              backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
            })}
          >
            <Icon name="map-pin" size={20} color="text" />
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              {t(NAV_NAME[app])}
            </Text>
            {current === app ? <Icon name="check" size={20} color="accentText" /> : null}
          </Pressable>
        ))}
      </View>
    </ModalSheet>
  );
}

export function navAppName(app: NavApp): 'partner.nav_google' | 'partner.nav_waze' {
  return NAV_NAME[app];
}
