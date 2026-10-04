import { Pressable, Switch, View } from 'react-native';
import { Button, Text, useTheme, useToast } from '@driver/ui';
import { EntryTile } from '@/components/EntryTile';
import { Page } from '@/components/Page';
import { testChime } from '@/lib/alert-sound';
import { useT } from '@/lib/i18n';
import { prefs, usePrefs, type AppLocale } from '@/lib/prefs';
import { color } from '@driver/design-tokens';

function Toggle({ value, onChange, testID }: { value: boolean; onChange: (v: boolean) => void; testID: string }) {
  const theme = useTheme();
  return (
    <Switch
      testID={testID}
      value={value}
      onValueChange={onChange}
      trackColor={{ true: theme.colors.success, false: theme.colors.borderStrong }}
      thumbColor={color.neutral[0]}
      {...({ activeThumbColor: color.neutral[0] } as object)}
    />
  );
}

/** الإعدادات — order sound, auto-print, language. Device preferences (per tablet). */
export default function Settings() {
  const theme = useTheme();
  const t = useT();
  const p = usePrefs();
  const toast = useToast();
  const test = async () => {
    const ok = await testChime();
    if (!ok) toast.show({ message: t('merchant.settings.test_sound_blocked'), tone: 'warning' });
  };
  const langs: readonly { value: AppLocale; label: string }[] = [
    { value: 'ar-IQ', label: t('merchant.settings.lang_ar') },
    { value: 'en', label: t('merchant.settings.lang_en') },
  ];
  return (
    <Page title={t('merchant.settings.title')} back testID="settings" maxWidth={720}>
      <EntryTile
        icon="volume"
        title={t('merchant.settings.sound')}
        hint={t('merchant.settings.sound_hint')}
        trailing={<Toggle testID="setting-sound" value={p.soundOn} onChange={(v) => void prefs.setSound(v)} />}
      />
      {/* "جرّب الصوت": the real new-order chime at full volume (S-01). */}
      <EntryTile
        icon="bell"
        testID="test-sound"
        title={t('merchant.settings.test_sound')}
        hint={t('merchant.settings.test_sound_hint')}
        onPress={() => void test()}
        trailing={<Button testID="test-sound-play" label={t('merchant.settings.test_sound_play')} icon="bell" variant="secondary" size="sm" onPress={() => void test()} />}
      />
      <EntryTile icon="printer" title={t('merchant.settings.auto_print')} trailing={<Toggle testID="setting-autoprint" value={p.autoPrint} onChange={(v) => void prefs.setAutoPrint(v)} />} />
      <View style={{ gap: theme.space[2] }}>
        <Text variant="label" color="textMuted">
          {t('merchant.settings.language')}
        </Text>
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          {langs.map((l) => {
            const selected = p.locale === l.value;
            return (
              <Pressable
                key={l.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => void prefs.setLocale(l.value)}
                style={{ flex: 1, height: 52, borderRadius: theme.radius.lg, borderWidth: selected ? 2 : 1, borderColor: selected ? theme.colors.accent : theme.colors.border, backgroundColor: selected ? theme.colors.accentTint : theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text variant="bodyStrong" color={selected ? 'accentText' : 'text'}>
                  {l.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Page>
  );
}
