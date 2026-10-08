import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Icon, ModalSheet, Text, useTheme, useToast } from '@driver/ui';
import { playTestSound } from '@/lib/alert';
import { useT } from '@/lib/i18n';
import { storage } from '@/lib/storage';
import { shiftCheckDay } from './logic';

const KEY = 'driver.partner.shift_check_day';

/** Whether today's check was already done on this phone (null while reading storage). */
export function useShiftCheckDue(): { due: boolean | null; markDone: () => void } {
  const [due, setDue] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void storage
      .getItem(KEY)
      .then((v) => live && setDue(v !== shiftCheckDay(new Date())))
      .catch(() => live && setDue(true));
    return () => {
      live = false;
    };
  }, []);
  return {
    due,
    markDone: () => {
      setDue(false);
      void storage.setItem(KEY, shiftCheckDay(new Date())).catch(() => undefined);
    },
  };
}

/**
 * h8 «قبل ما تبدي»: once a day, before the first slide — today's check-in (already done, or one tap
 * to it) and a sound test he actually hears. Then «تمام، يلا» starts the shift. "Do you have change?"
 * waits for Ali's rule on it (idea x2), so it isn't asked: a question that changes nothing isn't asked.
 */
export function ShiftCheckSheet({ visible, checkedIn, onGo, onLater }: { visible: boolean; checkedIn: boolean; onGo: () => void; onLater: () => void }) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const [heard, setHeard] = useState(false);
  const test = async () => {
    const ok = await playTestSound();
    if (!ok) toast.show({ message: t('partner.test_sound_blocked'), tone: 'warning' });
    else setHeard(true);
  };
  const row = (icon: 'check' | 'volume', title: string, right: React.ReactNode, testID: string) => (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], minHeight: 64, borderRadius: 18, borderWidth: 1.5, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
      <Icon name={icon} size={20} color={icon === 'check' && checkedIn ? 'successText' : 'text'} strokeWidth={2.2} />
      <Text variant="label" weight={600} style={{ flex: 1 }}>
        {title}
      </Text>
      {right}
    </View>
  );
  const done = (label: string) => (
    <View style={{ backgroundColor: theme.colors.successTint, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 }}>
      <Text variant="caption" weight={700} color="successText">
        {label}
      </Text>
    </View>
  );
  return (
    <ModalSheet visible={visible} onClose={onLater} title={t('partner.check_title')} testID="shift-check">
      <View style={{ gap: theme.space[3] }}>
        <Text variant="footnote" color="textMuted">
          {t('partner.check_sub')}
        </Text>
        {row(
          'check',
          t('partner.check_checkin'),
          checkedIn ? done(t('partner.check_checkin_done')) : <Button size="sm" variant="secondary" label={t('partner.check_checkin_do')} onPress={() => router.push('/checkin')} style={{ minHeight: 44 }} />,
          'check-checkin',
        )}
        {row(
          'volume',
          t('partner.check_sound'),
          heard ? done(t('partner.check_sound_heard')) : <Button testID="check-sound-try" size="sm" variant="secondary" icon="volume" label={t('partner.check_sound_try')} onPress={() => void test()} style={{ minHeight: 44 }} />,
          'check-sound',
        )}
        <Button testID="check-go" label={t('partner.check_go')} size="lg" fullWidth disabled={!checkedIn} onPress={onGo} />
        <Button testID="check-later" label={t('partner.check_later')} variant="ghost" fullWidth onPress={onLater} />
      </View>
    </ModalSheet>
  );
}
