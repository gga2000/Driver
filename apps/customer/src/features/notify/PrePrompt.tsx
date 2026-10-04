import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { Button, Icon, Text, useTheme, type IconName } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { storage } from '@/lib/storage';
import { PREPROMPT_KEY, shouldShowPrePrompt } from './prompt';
import { usePushPermission } from './usePush';

const POINTS: ReadonlyArray<{ icon: IconName; key: 'notify.preprompt.customer_point_status' | 'notify.preprompt.customer_point_door' | 'notify.preprompt.customer_point_receipts' }> = [
  { icon: 'clock', key: 'notify.preprompt.customer_point_status' },
  { icon: 'map-pin', key: 'notify.preprompt.customer_point_door' },
  { icon: 'receipt', key: 'notify.preprompt.customer_point_receipts' },
];

/**
 * Our own ask before the OS prompt (the OS one can be shown once; a "no" there is forever): what the
 * person gets, in Iraqi Arabic, with "إي، شغّلها" → OS prompt and "بعدين" → asked again in a week.
 */
export function PrePrompt({ visible, onAllow, onLater, busy }: { visible: boolean; onAllow: () => void; onLater: () => void; busy?: boolean }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onLater} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessibilityLabel={t('notify.preprompt.later')} onPress={onLater} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: 'rgba(15, 18, 22, 0.45)' }} />
        <View
          testID="push-preprompt"
          style={{
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            paddingHorizontal: theme.space[5],
            paddingTop: theme.space[6],
            paddingBottom: theme.space[8],
            gap: theme.space[4],
          }}
        >
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
            <Icon name="bell" size={30} color="accentText" />
          </View>
          <View style={{ gap: theme.space[2] }}>
            <Text variant="heading" align="center" accessibilityRole="header">
              {t('notify.preprompt.customer_title')}
            </Text>
            <Text variant="body" color="textMuted" align="center">
              {t('notify.preprompt.customer_body')}
            </Text>
          </View>
          <View style={{ gap: theme.space[3], paddingVertical: theme.space[2] }}>
            {POINTS.map((p) => (
              <View key={p.key} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                <View style={{ width: 36, height: 36, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={p.icon} size={18} color="text" />
                </View>
                <Text variant="label" style={{ flex: 1 }}>
                  {t(p.key)}
                </Text>
              </View>
            ))}
          </View>
          <Button testID="push-preprompt-allow" label={t('notify.preprompt.allow')} size="lg" fullWidth loading={busy} onPress={onAllow} />
          <Button testID="push-preprompt-later" label={t('notify.preprompt.later')} variant="ghost" size="lg" fullWidth onPress={onLater} />
        </View>
      </View>
    </Modal>
  );
}

/**
 * Shows the pre-prompt when it is the right moment (`active`: the screen that makes notifications
 * matter is open — the first order screen) and the permission is still undetermined and not snoozed.
 */
export function PrePromptGate({ active }: { active: boolean }) {
  const { permission, ask } = usePushPermission();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active || permission === null) return;
    let cancelled = false;
    void (async () => {
      const raw = await storage.getItem(PREPROMPT_KEY);
      const last = raw ? Number(raw) : null;
      if (!cancelled && shouldShowPrePrompt(permission, Number.isFinite(last) ? last : null, Date.now())) setVisible(true);
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
  return <PrePrompt visible={visible} busy={busy} onAllow={() => void allow()} onLater={later} />;
}
