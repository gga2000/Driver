import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { Button, Icon, Text, useTheme, withAlpha, type IconName } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { answerLocationDisclosure } from '@/lib/disclosure';
import { useT } from '@/lib/i18n';

const WHY: ReadonlyArray<{ icon: IconName; key: 'partner.f4_why_offers' | 'partner.f4_why_customer' | 'partner.f4_why_stops' }> = [
  { icon: 'bell', key: 'partner.f4_why_offers' },
  { icon: 'map-pin', key: 'partner.f4_why_customer' },
  { icon: 'moon', key: 'partner.f4_why_stops' },
];

/**
 * Google Play's prominent disclosure (partner redesign f4), our own screen, shown only when he goes to
 * work and right before the OS asks for "allow all the time": what we collect, when, why, and when it
 * stops — then the OS choice he will see, drawn, so «السماح طوال الوقت» is easy to find. «مو هسة» keeps
 * the app working while it is open.
 */
export default function LocationWhy() {
  const theme = useTheme();
  const t = useT();
  const answered = useRef(false);
  const answer = (ok: boolean) => {
    answered.current = true;
    answerLocationDisclosure(ok);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  // Leaving any other way (back gesture, hardware back) is "not now".
  useEffect(
    () => () => {
      if (!answered.current) answerLocationDisclosure(false);
    },
    [],
  );
  return (
    <Screen
      testID="location-why"
      edges={['top', 'bottom']}
      contentStyle={{ gap: theme.space[5] }}
      footer={
        <View style={{ gap: theme.space[2] }}>
          <Button testID="location-why-allow" label={t('partner.f4_continue')} size="lg" fullWidth haptic="medium" onPress={() => answer(true)} />
          <Button testID="location-why-later" label={t('partner.bg_location_disclosure_later')} variant="ghost" fullWidth onPress={() => answer(false)} />
        </View>
      }
    >
      <View style={{ alignItems: 'center', paddingTop: theme.space[4] }}>
        <View style={{ width: 112, height: 112, borderRadius: 56, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="location-arrow" size={34} color={theme.colors.onAccent} strokeWidth={2.2} />
          </View>
        </View>
      </View>
      <View style={{ gap: theme.space[2] }}>
        <Text variant="heading" accessibilityRole="header" align="center">
          {t('partner.bg_location_disclosure_title')}
        </Text>
        {/* The sentence Google asks for, word for word in spirit: what, when (even closed), why. */}
        <Text testID="location-why-statement" variant="body" color="textMuted" align="center">
          {t('partner.f4_statement')}
        </Text>
      </View>
      <View style={{ gap: theme.space[3] }}>
        {WHY.map((w) => (
          <View key={w.key} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={w.icon} size={20} color="text" strokeWidth={2} />
            </View>
            <Text variant="label" style={{ flex: 1 }}>
              {t(w.key)}
            </Text>
          </View>
        ))}
      </View>
      {/* What the next screen looks like: the phone's own question, the right choice marked. */}
      <View testID="location-why-os" style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, padding: theme.space[4], gap: theme.space[2] }}>
        <Text variant="caption" color="textMuted">
          {t('partner.f4_next_screen')}
        </Text>
        {(['partner.f4_os_always', 'partner.f4_os_while', 'partner.f4_os_deny'] as const).map((k, i) => (
          <View
            key={k}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[2],
              minHeight: 40,
              paddingHorizontal: theme.space[3],
              borderRadius: theme.radius.md,
              backgroundColor: i === 0 ? theme.colors.accentTint : 'transparent',
              borderWidth: i === 0 ? 1.5 : 0,
              borderColor: withAlpha(theme.colors.accent, 0.6),
            }}
          >
            <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: i === 0 ? theme.colors.accentText : theme.colors.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
              {i === 0 ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.accentText }} /> : null}
            </View>
            <Text variant="label" weight={i === 0 ? 700 : 400} color={i === 0 ? 'accentText' : 'textMuted'} style={{ flex: 1 }}>
              {t(k)}
            </Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}
