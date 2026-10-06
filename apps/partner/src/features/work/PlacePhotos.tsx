import { Image, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, Text, useTheme } from '@driver/ui';
import { absoluteUrl } from '@/features/account/photo';
import { useT } from '@/lib/i18n';

/** A photo on a job card: upload id and a short-lived signed link. */
export interface PlacePhoto {
  id: string;
  url: string;
}

const THUMB = 72;

/**
 * Thumbnails of a place's photos on a job card — the customer's door (DoorCard) and the kitchen's
 * pickup spot (PickupSpotCard) — each opening the full-screen viewer. One strip so both cards look
 * and behave the same.
 */
export function PhotoStrip({ photos, onOpen, photoLabel, testIDPrefix }: { photos: readonly PlacePhoto[]; onOpen: (index: number) => void; photoLabel: (n: number) => string; testIDPrefix: string }) {
  const theme = useTheme();
  if (photos.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
      {photos.map((p, i) => (
        <Pressable
          key={p.id}
          onPress={() => onOpen(i)}
          accessibilityRole="imagebutton"
          accessibilityLabel={photoLabel(i + 1)}
          testID={`${testIDPrefix}-photo-${i}`}
          style={{ width: THUMB, height: THUMB, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: theme.colors.surface }}
        >
          <Image source={{ uri: absoluteUrl(p.url) }} style={{ width: THUMB, height: THUMB }} resizeMode="cover" />
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Full-screen photo viewer: a tap moves to the next photo (or closes the last one alone), the title
 * pill says which place and which photo («باب الزبون · 1/2»). `index` null = closed.
 */
export function PhotoViewer({ photos, index, onIndex, title, testIDPrefix }: { photos: readonly PlacePhoto[]; index: number | null; onIndex: (i: number | null) => void; title: string; testIDPrefix: string }) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const photo = index === null ? null : photos[index];
  const close = () => onIndex(null);
  return (
    <Modal visible={Boolean(photo)} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View testID={`${testIDPrefix}-viewer`} style={{ flex: 1, backgroundColor: theme.colors.scrim, paddingTop: insets.top + theme.space[3], paddingBottom: insets.bottom + theme.space[4], paddingHorizontal: theme.space[4], gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ flex: 1, alignSelf: 'flex-start', paddingHorizontal: theme.space[3], paddingVertical: theme.space[1], borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface }}>
            <Text variant="label" weight={600}>
              {title}
              {photos.length > 1 && index !== null ? ` · ${index + 1}/${photos.length}` : ''}
            </Text>
          </View>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t('action.close')} testID={`${testIDPrefix}-close`} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface }}>
            <Icon name="x" size={22} color="text" />
          </Pressable>
        </View>
        {photo ? (
          <Pressable style={{ flex: 1 }} onPress={() => (index !== null && photos.length > 1 ? onIndex((index + 1) % photos.length) : close())} accessibilityRole="imagebutton" accessibilityLabel={t('partner.door_photo_next')}>
            <Image source={{ uri: absoluteUrl(photo.url) }} style={{ flex: 1, borderRadius: theme.radius.lg }} resizeMode="contain" />
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}
