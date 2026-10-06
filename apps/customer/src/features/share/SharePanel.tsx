import { useState } from 'react';
import { Share, View } from 'react-native';
import type { ShareLink } from '@driver/contracts';
import { Button, Icon, Text, useTheme, useToast } from '@driver/ui';
import { shareUrl } from '@/features/rajaa/share';
import { BottomPanel } from '@/features/track/Panels';
import { apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

/**
 * Share-trip sheet (scoring & safety §5; edge-case review C-126): what the person who opens the link
 * sees (and never sees), the link itself, how often it was opened, when it stops, and "وقّف المشاركة".
 * A delivery (maps program SP3c) says what the family sees of an order instead of a ride.
 */
export function SharePanel({ link, message, onClose, onChanged }: { link: ShareLink; message: (url: string) => string; onClose: () => void; onChanged: (l: ShareLink | null) => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const client = useApiClient();
  const [busy, setBusy] = useState(false);
  const url = shareUrl(link.path);

  const send = async () => {
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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentTint }}>
          <Icon name="share" size={22} color="accentText" strokeWidth={2} />
        </View>
        <Text variant="heading" style={{ flex: 1 }}>
          {t(link.subject === 'delivery' ? 'share.sheet_title_delivery' : 'share.sheet_title')}
        </Text>
      </View>
      <Text color="textMuted">{t(link.subject === 'delivery' ? 'share.sheet_body_delivery' : 'share.sheet_body')}</Text>
      <View style={{ gap: theme.space[1], backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
        <Text variant="label" weight={600} numberOfLines={1} style={{ writingDirection: 'ltr', textAlign: 'left' }} selectable testID="share-url">
          {url}
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space[2] }}>
          <Text variant="caption" color="textMuted" tabular>
            {link.views > 0 ? t('share.views', { count: link.views }) : t('share.views_none')}
          </Text>
          <Text variant="caption" color="textMuted" tabular>
            {t('share.expires_after')}
          </Text>
        </View>
      </View>
      <Button label={t('share.send')} icon="share" size="lg" fullWidth onPress={() => void send()} testID="share-send" />
      <Button label={t('share.revoke')} icon="x" variant="ghost" fullWidth loading={busy} onPress={() => void revoke()} testID="share-revoke" />
    </BottomPanel>
  );
}
