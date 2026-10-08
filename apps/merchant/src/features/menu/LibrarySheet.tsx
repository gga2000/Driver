import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Button, Chip, ModalSheet, Text, useTheme } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { COUNTER } from '@/lib/counter';
import { useT, type TKey } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { LIBRARY, type LibraryDish } from './library-data';
import { LIBRARY_SECTIONS, libraryMatches, type LibrarySection } from './library';
import { absoluteUrl, type PickedPhoto } from './photo';

type Tab = 'match' | LibrarySection;

/**
 * A library photo as a picked photo: its address on the API, uploaded like any other, so the dish keeps
 * its own copy (the stored photo is the kitchen's upload, never a link into the library).
 */
export function libraryPhoto(path: string): PickedPhoto {
  return { uri: absoluteUrl(path), contentType: 'image/webp' };
}

/**
 * One library photo from the API (expo-image keeps it in memory and on disk once seen). While it loads,
 * the tile's sand bed shows; if it cannot load, a quiet dish glyph takes its place, never a broken image.
 */
export function LibraryImage({ path, recyclingKey }: { path: string; recyclingKey: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [path]);
  if (failed) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} testID={`${recyclingKey}-fallback`}>
        <MIcon name="utensils" size={28} color="textMuted" />
      </View>
    );
  }
  return <Image source={{ uri: absoluteUrl(path) }} cachePolicy="memory-disk" recyclingKey={recyclingKey} transition={160} contentFit="cover" onError={() => setFailed(true)} style={{ width: '100%', height: '100%' }} accessibilityIgnoresInvertColors />;
}

/**
 * «من صورنا» (Ali, 2026-10-08): pick a photo of the dish from Driver's library when there's no time to
 * take one. Dishes that fit the name come first; the rest by kind. The shop can swap in its own photo
 * any time, and the sheet says so.
 */
export function LibrarySheet({ visible, name, section, busy, onClose, onPick }: { visible: boolean; name: string; section: string | null; busy: boolean; onClose: () => void; onPick: (path: string) => void }) {
  const theme = useTheme();
  const t = useT();
  const { wide } = useLayout();
  const matches = useMemo(() => libraryMatches(LIBRARY, name, section), [name, section]);
  const [tab, setTab] = useState<Tab>('match');
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setTab(matches.length > 0 ? 'match' : 'grill');
    setPicked(null);
  }, [visible, matches.length]);

  const dishes: readonly LibraryDish[] = tab === 'match' ? matches : LIBRARY.filter((d) => d.section === tab);
  const tabs: Tab[] = matches.length > 0 ? ['match', ...LIBRARY_SECTIONS] : [...LIBRARY_SECTIONS];
  const tile = wide ? 200 : 150;

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      locked={busy}
      size="lg"
      testID="library-sheet"
      title={t('merchant.library.title')}
      subtitle={t('merchant.library.subtitle')}
      footer={<Button testID="library-use" label={t('merchant.library.use')} fullWidth size="lg" disabled={picked === null} loading={busy} onPress={() => picked !== null && onPick(picked)} />}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2], paddingEnd: theme.space[2] }} style={{ flexGrow: 0 }}>
        {tabs.map((k) => (
          <Chip key={k} testID={`library-tab-${k}`} role="radio" selected={tab === k} label={k === 'match' ? t('merchant.library.match', { name: name.trim() || '…' }) : t(`merchant.library.section_${k}` as TKey)} onPress={() => setTab(k)} />
        ))}
      </ScrollView>
      <View style={{ gap: theme.space[5], paddingTop: theme.space[3] }}>
        {dishes.map((d) => (
          <View key={d.slug} style={{ gap: theme.space[2] }}>
            <Text variant="bodyStrong">{d.nameAr}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
              {d.photos.map((src, i) => {
                const on = picked === src;
                return (
                  <Pressable
                    key={i}
                    testID={`library-${d.slug}-${i + 1}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={t('merchant.library.photo_label', { name: d.nameAr, n: i + 1 })}
                    onPress={() => setPicked(src)}
                    style={({ pressed }) => ({ width: tile, aspectRatio: 4 / 3, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: COUNTER.sand, borderWidth: 3, borderColor: on ? COUNTER.date : 'transparent', opacity: pressed ? 0.85 : 1 })}
                  >
                    <LibraryImage path={src} recyclingKey={`library-${d.slug}-${i + 1}`} />
                    {on ? (
                      <View style={{ position: 'absolute', top: 6, end: 6, width: 30, height: 30, borderRadius: 15, backgroundColor: COUNTER.date, alignItems: 'center', justifyContent: 'center' }}>
                        <MIcon name="check" size={18} color={COUNTER.onDate} strokeWidth={2.6} />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </View>
    </ModalSheet>
  );
}
