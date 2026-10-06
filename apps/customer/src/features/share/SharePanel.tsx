import { useState } from 'react';
import { Linking, Share, View } from 'react-native';
import type { ShareLink } from '@driver/contracts';
import { Avatar, Button, Icon, PlateChip, Text, useTheme, useToast } from '@driver/ui';
import { shareUrl } from '@/features/rajaa/share';
import { BottomPanel } from '@/features/track/Panels';
import { apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

/** What the person who opens the link sees of the driver (first name, car, plate), when known. */
export interface SharePreview {
  driverName: string | null;
  vehicle: string | null;
  plate: string | null;
}

/** `https://wa.me/?text=…`: WhatsApp opens with the message typed, the person picks who gets it. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Share-trip sheet (scoring & safety §5; edge-case review C-126; joy l8, audit L-22): a preview of
 * what the family sees — never a raw URL — then «دز على واتساب» first (Iraqi families coordinate
 * there), any other app second, how often it was opened, when it stops, and «وقّف المشاركة».
 * A delivery (maps program SP3c) says what the family sees of an order instead of a ride.
 */
export function SharePanel({ link, message, preview, onClose, onChanged }: { link: ShareLink; message: (url: string) => string; preview?: SharePreview | null; onClose: () => void; onChanged: (l: ShareLink | null) => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const client = useApiClient();
  const [busy, setBusy] = useState(false);
  const url = shareUrl(link.path);
  const delivery = link.subject === 'delivery';

  const whatsapp = async () => {
    try {
      await Linking.openURL(whatsappShareUrl(message(url)));
    } catch {
      await other();
    }
  };
  const other = async () => {
    try {
      await Share.share({ message: message(url) });
    } catch {
      toast.show({ message: t('rajaa.share_copied', { link: url }) }, 6000);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await client.tracking.revokeShareLink.mutate({ token: link.token });
      toast.show({ message: t('share.revoked'), tone: 'neutral', icon: 'share' });
      onChanged(null);
      onClose();
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomPanel onClose={onClose} testID="share-panel">
      <Text variant="heading">{t(delivery ? 'share.sheet_title_delivery' : 'share.sheet_title')}</Text>

      {/* The preview: what the family sees on their phone. */}
      <View testID="share-preview" style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.surfaceSunken }}>
        <Text variant="caption" color="textMuted" weight={600}>
          {t('share.preview_title')}
        </Text>
        {preview && (preview.driverName || preview.plate) ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <Avatar name={preview.driverName ?? '؟'} size={40} {...(preview.driverName ? {} : { icon: 'user' as const })} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text variant="label" weight={600} numberOfLines={1}>
                {preview.driverName ?? t(delivery ? 'share.preview_courier' : 'share.preview_driver')}
              </Text>
              {preview.vehicle ? (
                <Text variant="caption" color="textMuted" numberOfLines={1}>
                  {preview.vehicle}
                </Text>
              ) : null}
            </View>
            {preview.plate ? <PlateChip plate={preview.plate} accessibilityLabel={t('driver.plate')} /> : null}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="map-pin" size={16} color="liveText" />
          <Text variant="footnote" style={{ flex: 1 }}>
            {t(delivery ? 'share.preview_map_delivery' : 'share.preview_map')}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="shield" size={16} color="textMuted" />
          <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
            {t('share.preview_never')}
          </Text>
        </View>
      </View>

      <Button label={t('share.send_whatsapp')} icon="chat" size="lg" fullWidth onPress={() => void whatsapp()} testID="share-send" />
      <Button label={t('share.send_other')} icon="share" variant="secondary" fullWidth onPress={() => void other()} testID="share-send-other" />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space[2] }}>
        <Text variant="caption" color="textMuted" tabular>
          {link.views > 0 ? t('share.views', { count: link.views }) : t('share.views_none')}
        </Text>
        <Text variant="caption" color="textMuted" tabular>
          {t('share.expires_after')}
        </Text>
      </View>
      <Button label={t('share.revoke')} icon="x" variant="ghost" fullWidth loading={busy} onPress={() => void revoke()} testID="share-revoke" />
    </BottomPanel>
  );
}
