import { useState } from 'react';
import { Linking, Share, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button, Icon, Text, useTheme, useToast } from '@driver/ui';
import { whatsappShareUrl } from '@/features/share/SharePanel';
import { useT } from '@/lib/i18n';
import { parcelSwatch } from './palette';

/**
 * «دز الرابط للمستلم» (Ali, 2026-10-12): our text message may not go out (daily caps, a wrong network), so the
 * sender gets the receiver's link to send himself — WhatsApp first, as families do, any app second — and is told
 * plainly that the receiver needs no app. `link` is null when this phone doesn't hold it (the app restarted):
 * the buttons then ask the server for a new one first (`getLink`, the old link stops opening).
 */
export function ShareDoorLink({ name, what, link, getLink, testID = 'parcel-link' }: { name: string; what: string; link: string | null; getLink: () => Promise<string | null>; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const sw = parcelSwatch(theme);
  const [busy, setBusy] = useState<'whatsapp' | 'other' | null>(null);

  const withLink = async (how: 'whatsapp' | 'other') => {
    setBusy(how);
    try {
      const url = link ?? (await getLink());
      if (!url) return;
      const message = t('parcel.c_link_message', { what, link: url });
      if (how === 'whatsapp') {
        try {
          await Linking.openURL(whatsappShareUrl(message));
          return;
        } catch {
          // No WhatsApp here: the phone's own share sheet.
        }
      }
      try {
        await Share.share({ message });
      } catch {
        toast.show({ message: t('parcel.c_link_copied', { link: url }) }, 8000);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Animated.View
      testID={testID}
      entering={theme.reduceMotion ? undefined : FadeInDown.duration(240)}
      style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: sw.wash, borderWidth: 1, borderColor: sw.fill }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name="share" size={20} color={sw.text} strokeWidth={2.2} />
        <Text variant="title" style={{ flex: 1 }}>
          {t('parcel.c_link_title')}
        </Text>
      </View>
      <Text variant="footnote" color="textMuted">
        {t('parcel.c_link_body', { name })}
      </Text>
      <Button label={t('share.send_whatsapp')} icon="chat" variant="ink" fullWidth loading={busy === 'whatsapp'} disabled={busy !== null} onPress={() => void withLink('whatsapp')} testID={`${testID}-whatsapp`} />
      <Button label={t('share.send_other')} icon="share" variant="secondary" fullWidth loading={busy === 'other'} disabled={busy !== null} onPress={() => void withLink('other')} testID={`${testID}-other`} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], justifyContent: 'center' }}>
        <Icon name="phone" size={14} color="textMuted" />
        <Text variant="caption" color="textMuted">
          {t('parcel.c_door_no_app')}
        </Text>
      </View>
    </Animated.View>
  );
}
