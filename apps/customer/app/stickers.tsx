import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';
import { Card, Icon, STICKERS, Text, useTheme, useToast } from '@driver/ui';
import { HeaderBack } from '@/features/food/HeaderBack';
import { Screen } from '@/components/Screen';
import { STICKER_FILES } from '@/features/stickers/files';
import { packStickers } from '@/features/stickers/pack';
import { useT } from '@/lib/i18n';
import { shareAsset } from '@/lib/share-file';

/**
 * «ستيكرات درايفر» (joy g7): the pack drawn from the Aziziyah sketchbook with Iraqi lines. Tapping one
 * opens the share sheet with its 512×512 WebP (WhatsApp sends it as a sticker); on the web it is
 * shared as a file or downloaded. Adding the whole pack to WhatsApp at once needs a native part that
 * this build can't carry yet (plan deviation), and the screen says so plainly.
 */
export default function StickersScreen() {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const stickers = packStickers(STICKERS, STICKER_FILES);
  const [busy, setBusy] = useState<string | null>(null);

  const send = async (id: string) => {
    const s = stickers.find((x) => x.id === id);
    if (!s || busy) return;
    setBusy(id);
    const result = await shareAsset(s.source, s.fileName, 'image/webp', t(s.line));
    setBusy(null);
    if (result === 'saved') toast.show({ message: t('sticker.saved'), tone: 'success', icon: 'check' });
    else if (result === 'failed') toast.show({ message: t('sticker.failed'), tone: 'danger' });
  };

  return (
    <Screen edges={['bottom']} testID="stickers">
      <Stack.Screen options={{ title: t('sticker.title'), headerLeft: () => <HeaderBack fallback="/account" /> }} />
      <Text variant="body" color="textMuted">
        {t('sticker.subtitle')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[3], justifyContent: 'space-between' }}>
        {stickers.map((s) => (
          <Pressable
            key={s.id}
            testID={`sticker-${s.id}`}
            accessibilityRole="button"
            accessibilityLabel={t('sticker.send_a11y', { line: t(s.line) })}
            onPress={() => void send(s.id)}
            style={({ pressed }) => ({
              width: '47%',
              aspectRatio: 1,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Image source={s.source} style={{ width: '88%', height: '88%' }} resizeMode="contain" accessibilityIgnoresInvertColors />
            {busy === s.id ? (
              <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color={theme.colors.accentText} />
              </View>
            ) : null}
          </Pressable>
        ))}
      </View>
      <Card elevation={0} padding={3} testID="stickers-note">
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
          <View style={{ marginTop: 2 }}>
            <Icon name="share" size={16} color="textMuted" />
          </View>
          <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
            {t('sticker.note')}
          </Text>
        </View>
      </Card>
    </Screen>
  );
}
