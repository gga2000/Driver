import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { pluralKey } from '@driver/i18n';
import { Icon, Text, useMotionPresets, useTheme, useToast } from '@driver/ui';
import { STICKER_FILES } from '@/features/stickers/files';
import { useT } from '@/lib/i18n';
import { shareAsset } from '@/lib/share-file';
import { useSeason } from '@/lib/use-season';
import type { RideSticker } from './firsts';

/**
 * Ride stickers (ride idea g2): on the arrival screen of the first night ride or a milestone ride, the
 * sticker it earned with one warm line and «أرسله» — the share sheet with the pack's WebP, which
 * WhatsApp sends as a sticker (the same file as `/stickers`). Hidden on quiet days.
 */
export function RideStickerCard({ sticker }: { sticker: RideSticker | null }) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const presets = useMotionPresets();
  const today = useSeason();
  const [busy, setBusy] = useState(false);
  const source = sticker ? STICKER_FILES[sticker.stickerId] : undefined;
  if (!sticker || source === undefined || !today.celebrations) return null;
  const line =
    sticker.kind === 'night' ? t('firsts.sticker_night') : t('firsts.sticker_milestone', { trips: t(pluralKey('ride.trip_count', sticker.count), { n: sticker.count }) });
  const send = async () => {
    if (busy) return;
    setBusy(true);
    const result = await shareAsset(source, `driver-${sticker.stickerId}.webp`, 'image/webp', t(`sticker.line.${sticker.stickerId}`));
    setBusy(false);
    if (result === 'saved') toast.show({ message: t('sticker.saved'), tone: 'success', icon: 'check' });
    else if (result === 'failed') toast.show({ message: t('sticker.failed'), tone: 'danger' });
  };
  return (
    <Animated.View entering={presets.pop()} testID={`ride-sticker-${sticker.kind}`} accessibilityLiveRegion="polite" style={{ alignSelf: 'stretch' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          padding: theme.space[2],
          paddingEnd: theme.space[3],
          borderRadius: theme.radius.xl,
          backgroundColor: theme.colors.surface,
          borderWidth: 1.5,
          borderColor: theme.colors.deal,
        }}
      >
        <Image source={source} style={{ width: 60, height: 60 }} resizeMode="contain" accessibilityIgnoresInvertColors accessibilityLabel={t(`sticker.line.${sticker.stickerId}`)} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" weight={700} color="textMuted">
            {t('firsts.sticker_stamp')}
          </Text>
          <Text variant="bodyStrong">{line}</Text>
        </View>
        <Pressable
          testID="ride-sticker-send"
          accessibilityRole="button"
          accessibilityLabel={t('sticker.send_a11y', { line: t(`sticker.line.${sticker.stickerId}`) })}
          accessibilityState={{ busy }}
          onPress={() => void send()}
          style={({ pressed }) => ({
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: theme.space[3],
            borderRadius: 22,
            backgroundColor: pressed ? theme.colors.accentTint : theme.colors.surface,
            borderWidth: 1.5,
            borderColor: theme.colors.accent,
          })}
        >
          {busy ? <ActivityIndicator size="small" color={theme.colors.accentText} /> : <Icon name="share" size={16} color="accentText" strokeWidth={2.2} />}
          <Text variant="label" weight={700} color="accentText">
            {t('firsts.sticker_send')}
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}
