import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { storage } from '@/lib/storage';
import { PREPROMPT_KEY, shouldShowPrePrompt } from './prompt';
import { usePushPermission } from './usePush';

/**
 * Whether our notification ask should show now (`active`: the screen where it matters is open), and
 * its two answers. The OS prompt can be shown once and a "no" there is forever, so ours comes first:
 * "إي، خبرني" → the OS prompt; "لا هسة" → asked again in a week. Undetermined permissions only.
 */
export function usePushAsk(active: boolean): { visible: boolean; busy: boolean; allow: () => void; later: () => void } {
  const { permission, ask } = usePushPermission();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active || permission === null) {
      setVisible(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const raw = await storage.getItem(PREPROMPT_KEY).catch(() => null);
      const last = raw ? Number(raw) : null;
      if (!cancelled) setVisible(shouldShowPrePrompt(permission, last !== null && Number.isFinite(last) ? last : null, Date.now()));
    })();
    return () => {
      cancelled = true;
    };
  }, [active, permission]);

  const later = () => {
    setVisible(false);
    void storage.setItem(PREPROMPT_KEY, String(Date.now()));
  };
  const allow = async () => {
    setBusy(true);
    await ask();
    setBusy(false);
    setVisible(false);
    void storage.setItem(PREPROMPT_KEY, String(Date.now()));
  };
  return { visible, busy, allow: () => void allow(), later };
}

/**
 * Joy f1 (L-01): the ask as an inline card, never a sheet over the live map. Food: under the ring on
 * the kitchen-waiting screen («نخبرك أول ما المطعم يقبل؟»); rides: in the collapsed sheet once a driver
 * is coming («نخبرك لمن يوصل السايق؟»).
 */
export function PushAskCard({ kind, busy, onAllow, onLater }: { kind: 'food' | 'ride'; busy: boolean; onAllow: () => void; onLater: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Card elevation={0} padding={3} testID="push-ask" style={{ alignSelf: 'stretch', gap: theme.space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="bell" size={20} color="accentText" strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={700}>
            {t(kind === 'ride' ? 'notify.ask.ride_title' : 'notify.ask.food_title')}
          </Text>
          <Text variant="footnote" color="textMuted">
            {t('notify.ask.body')}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
        <Button label={t('notify.ask.yes')} icon="bell" loading={busy} onPress={onAllow} style={{ flex: 1 }} testID="push-ask-yes" />
        <Button label={t('notify.ask.no')} variant="ghost" onPress={onLater} style={{ flex: 1 }} testID="push-ask-no" />
      </View>
    </Card>
  );
}
