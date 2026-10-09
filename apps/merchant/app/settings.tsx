import { Pressable, View } from 'react-native';
import { Button, Text, useTheme } from '@driver/ui';
import { useCounterToast } from '@/lib/toast';
import { EntryTile } from '@/components/EntryTile';
import { Switch } from '@/components/Switch';
import { Page } from '@/components/Page';
import { testChime } from '@/lib/alert-sound';
import { useT } from '@/lib/i18n';
import { prefs, usePrefs, type AppLocale } from '@/lib/prefs';
import { router } from 'expo-router';
import { learn } from '@/features/board/learn';
import { useStartPractice } from '@/features/board/LearnCards';

function Toggle({ value, onChange, testID, label }: { value: boolean; onChange: (v: boolean) => void; testID: string; label: string }) {
  return <Switch testID={testID} value={value} onValueChange={onChange} accessibilityLabel={label} />;
}

/** الإعدادات — order sound, auto-print, language. Device preferences (per tablet). */
export default function Settings() {
  const theme = useTheme();
  const t = useT();
  const p = usePrefs();
  const toast = useCounterToast();
  const startPractice = useStartPractice();
  /** Back to the orders, where the lesson or the practice order shows. */
  const toBoard = (go: () => void) => {
    go();
    router.navigate('/');
  };
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
        trailing={<Toggle testID="setting-sound" label={t('merchant.settings.sound')} value={p.soundOn} onChange={(v) => void prefs.setSound(v)} />}
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
      <EntryTile icon="printer" title={t('merchant.settings.auto_print')} trailing={<Toggle testID="setting-autoprint" label={t('merchant.settings.auto_print')} value={p.autoPrint} onChange={(v) => void prefs.setAutoPrint(v)} />} />
      {/* s6: bigger ticket type, for a tablet read from across the kitchen. */}
      <EntryTile icon="receipt" title={t('merchant.settings.big_text')} hint={t('merchant.settings.big_text_hint')} trailing={<Toggle testID="setting-bigtext" label={t('merchant.settings.big_text')} value={p.bigText} onChange={(v) => void prefs.setBigText(v)} />} />
      {/* s1 / s2: the one-minute lesson and the practice order, any time. */}
      <EntryTile icon="bulb" testID="settings-lesson" title={t('merchant.settings.lesson')} hint={t('merchant.settings.lesson_hint')} onPress={() => toBoard(() => learn.showAgain())} />
      <EntryTile icon="bell" testID="settings-practice" title={t('merchant.settings.practice')} hint={t('merchant.settings.practice_hint')} onPress={() => toBoard(startPractice)} />
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
