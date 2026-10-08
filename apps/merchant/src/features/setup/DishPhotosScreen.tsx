import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { AdminMenuItem } from '@driver/contracts';
import { Button, Skeleton, Text, useTheme, withAlpha } from '@driver/ui';
import { both, Loadable } from '@/components/Loadable';
import { MIcon } from '@/components/MIcon';
import { Page } from '@/components/Page';
import { LIBRARY } from '@/features/menu/library-data';
import { libraryPhoto } from '@/features/menu/LibrarySheet';
import { pickPhotos } from '@/features/menu/photo';
import { useMenu, usePhotoUpload } from '@/features/menu/queries';
import { useCurrentStore } from '@/features/store/queries';
import { apiErrorMessage } from '@/lib/api';
import { COUNTER } from '@/lib/counter';
import { useLocale, useT } from '@/lib/i18n';
import { useCounterToast } from '@/lib/toast';
import { bestLibraryDish, doorsOf, menuScore, voiceOf } from './logic';
import { useSetup, useSetupActions } from './queries';
import { SetupBar } from './SetupRing';

/**
 * A photo on every dish (m3, g2): each dish without one gets the closest photos from Driver's library,
 * one tap to keep (customers see «صورة توضيحية» on it until his own arrives), or his own photo. A
 * library photo counts for going live (Ali, 2026-10-08).
 */
export function DishPhotosScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const { store } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const setup = useSetup(storeId);
  const menu = useMenu(storeId);
  const upload = usePhotoUpload();
  const { dishPhoto } = useSetupActions();
  const [working, setWorking] = useState<string | null>(null);
  const fail = (err: unknown) => toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });

  const keep = async (merchantOrgId: string, item: AdminMenuItem, src: number | string, slug: string) => {
    const uploadId = await upload(await libraryPhoto(src));
    await dishPhoto.mutateAsync({ merchantOrgId, itemId: item.id, uploadId, librarySlug: slug });
  };

  return (
    <Page title={t('merchant.setup.photos_title')} back testID="setup-photos" maxWidth={720}>
      <Loadable query={both(setup, menu)} stale={false} skeleton={<Skeleton height={420} radius={theme.radius.xl} />} failed={t('merchant.setup.load_failed')} testID="setup-photos">
        {([view, m]) => {
          const voice = voiceOf(doorsOf(view));
          const items = m.categories.flatMap((c) => c.items);
          const score = menuScore(items);
          const missing = items.filter((i) => !i.photoUrl);
          const matched = missing.map((i) => ({ item: i, dish: bestLibraryDish(LIBRARY, i.nameAr, i.categoryAr) })).filter((x) => x.dish !== null);
          const all = async () => {
            setWorking('all');
            try {
              for (const x of matched) {
                const src = x.dish!.photos[0];
                if (src !== undefined) await keep(view.merchantOrgId, x.item, src, x.dish!.slug);
              }
              theme.haptic('success');
            } catch (err) {
              fail(err);
            } finally {
              setWorking(null);
            }
          };
          if (items.length === 0) {
            return (
              <View style={{ gap: theme.space[4], alignItems: 'center', paddingVertical: theme.space[8] }}>
                <Text variant="body" color="textMuted" align="center">
                  {t('merchant.setup.photos_hint_after')}
                </Text>
                <Button label={t('merchant.setup.step_menu')} size="lg" onPress={() => router.replace('/setup/menu')} />
              </View>
            );
          }
          return (
            <View style={{ gap: theme.space[4] }}>
              <View testID="setup-photos-score" style={{ gap: theme.space[2] }}>
                <Text variant="bodyStrong" tabular>
                  {t('merchant.setup.score', { done: score.withPhoto, total: score.total })}
                </Text>
                <SetupBar percent={Math.round((score.withPhoto / Math.max(1, score.total)) * 100)} />
              </View>
              {missing.length === 0 ? (
                <View testID="setup-photos-done" style={{ alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[6] }}>
                  <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: COUNTER.ready, alignItems: 'center', justifyContent: 'center' }}>
                    <MIcon name="check" size={36} color={COUNTER.onDate} strokeWidth={2.6} />
                  </View>
                  <Text variant="heading" align="center">
                    {t(voice === 'drinks' ? 'merchant.setup.photos_done_drinks' : 'merchant.setup.photos_done')}
                  </Text>
                  <Text variant="footnote" color="textMuted" align="center">
                    {t('merchant.setup.photos_done_note')}
                  </Text>
                  <Button testID="setup-photos-back" label={t('merchant.setup.back_to_list')} size="lg" onPress={() => router.navigate('/setup')} />
                </View>
              ) : (
                <>
                  {matched.length > 0 ? (
                    <Button testID="setup-photos-all" label={t('merchant.setup.photos_all', { count: matched.length })} icon="check" size="lg" fullWidth loading={working === 'all'} disabled={working !== null} onPress={() => void all()} />
                  ) : null}
                  <Text variant="footnote" color="textMuted">
                    {t('merchant.setup.photos_note')}
                  </Text>
                  {missing.map((item) => {
                    const dish = bestLibraryDish(LIBRARY, item.nameAr, item.categoryAr);
                    const own = async () => {
                      const res = await pickPhotos('library');
                      if (res === 'denied') return toast.show({ message: t('merchant.item.photo_denied'), tone: 'warning' });
                      const p = res?.[0];
                      if (!p) return;
                      setWorking(item.id);
                      try {
                        const uploadId = await upload(p);
                        await dishPhoto.mutateAsync({ merchantOrgId: view.merchantOrgId, itemId: item.id, uploadId, librarySlug: null });
                      } catch (err) {
                        fail(err);
                      } finally {
                        setWorking(null);
                      }
                    };
                    return (
                      <View key={item.id} testID={`setup-photo-${item.id}`} style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, opacity: working === item.id ? 0.6 : 1 }}>
                        <Text variant="bodyStrong" style={{ fontSize: 17 }}>
                          {item.nameAr}
                        </Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                          {(dish?.photos ?? []).slice(0, 3).map((src, i) => (
                            <Pressable
                              key={i}
                              testID={`setup-photo-${item.id}-${i + 1}`}
                              accessibilityRole="button"
                              accessibilityLabel={t('merchant.library.photo_label', { name: item.nameAr, n: i + 1 })}
                              disabled={working !== null}
                              onPress={async () => {
                                setWorking(item.id);
                                try {
                                  await keep(view.merchantOrgId, item, src, dish!.slug);
                                } catch (err) {
                                  fail(err);
                                } finally {
                                  setWorking(null);
                                }
                              }}
                              style={({ pressed }) => ({ width: 104, height: 80, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: COUNTER.sand, opacity: pressed ? 0.8 : 1 })}
                            >
                              <Image source={src} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                            </Pressable>
                          ))}
                          <Pressable testID={`setup-photo-own-${item.id}`} accessibilityRole="button" disabled={working !== null} onPress={() => void own()} style={({ pressed }) => ({ width: 104, height: 80, borderRadius: theme.radius.md, borderWidth: 2, borderStyle: 'dashed', borderColor: COUNTER.saffron, backgroundColor: withAlpha(COUNTER.saffron, 0.08), alignItems: 'center', justifyContent: 'center', gap: 2, opacity: pressed ? 0.8 : 1 })}>
                            <MIcon name="camera" size={20} color={COUNTER.newBadge} />
                            <Text variant="caption" weight={700} style={{ color: COUNTER.newBadge }}>
                              {t('merchant.setup.fix_own')}
                            </Text>
                          </Pressable>
                        </View>
                        {dish ? null : (
                          <Text variant="caption" color="textMuted">
                            {t('merchant.setup.photos_no_match')}
                          </Text>
                        )}
                      </View>
                    );
                  })}
                </>
              )}
            </View>
          );
        }}
      </Loadable>
    </Page>
  );
}
