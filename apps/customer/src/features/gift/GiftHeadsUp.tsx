import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { Button, Card, Icon, Text, useTheme, useToast } from '@driver/ui';
import { whatsappUrl } from '@/features/help/whatsapp';
import { shareUrl } from '@/features/rajaa/share';
import { apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { giftMessage, smsUrl } from './gift';
import type { GiftRecord } from './gift-store';

/**
 * «دز لـ أمي خبر العزيمة» (joy g1): the heads-up the sender sends from his own phone — WhatsApp or a
 * plain SMS — with his card line and the live tracking link (`tracking.createShareLink`, the o12 page).
 * No message leaves our servers, so it costs nothing and carries no number we keep.
 */
export function useGiftHeadsUp(orderId: string | null | undefined, gift: GiftRecord | null, merchant: string) {
  const client = useApiClient();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const [busy, setBusy] = useState<'whatsapp' | 'sms' | null>(null);
  const send = async (channel: 'whatsapp' | 'sms') => {
    if (!orderId || !gift) return;
    setBusy(channel);
    try {
      const link = await client.tracking.createShareLink.mutate({ orderId });
      const msg = giftMessage({ merchant, card: gift.card, url: shareUrl(link.path), paidByMe: gift.paidByMe });
      const text = t(msg.key, msg.params);
      await Linking.openURL(channel === 'whatsapp' ? whatsappUrl(gift.phone, text) : smsUrl(gift.phone, text, Platform.OS));
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };
  return { busy, send };
}

/** The card on the kitchen screen: the line, then WhatsApp first and SMS as the plain fallback. */
export function GiftHeadsUpCard({ orderId, gift, merchant }: { orderId: string; gift: GiftRecord; merchant: string }) {
  const theme = useTheme();
  const t = useT();
  const { busy, send } = useGiftHeadsUp(orderId, gift, merchant);
  return (
    <Card elevation={0} padding={3} style={{ alignSelf: 'stretch' }} testID="gift-heads-up">
      <View style={{ gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="gift" size={18} color="accentText" />
          <Text variant="label" weight={600} style={{ flex: 1 }}>
            {t('gift.send_title', { name: gift.name })}
          </Text>
        </View>
        {gift.card ? (
          <Text variant="body" face="voice" color="accentText" testID="gift-heads-up-card">
            {`«${gift.card}»`}
          </Text>
        ) : null}
        <Text variant="footnote" color="textMuted">
          {t('gift.send_body')}
        </Text>
        <View style={{ flexDirection: 'row', gap: theme.space[2], flexWrap: 'wrap' }}>
          <Button size="sm" icon="share" label={t('gift.send_whatsapp')} loading={busy === 'whatsapp'} onPress={() => void send('whatsapp')} testID="gift-send-whatsapp" />
          <Button size="sm" variant="secondary" icon="chat" label={t('gift.send_sms')} loading={busy === 'sms'} onPress={() => void send('sms')} testID="gift-send-sms" />
        </View>
      </View>
    </Card>
  );
}
