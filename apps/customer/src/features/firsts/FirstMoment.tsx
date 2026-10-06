import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Icon, Text, useMotionPresets, useTheme } from '@driver/ui';
import { useApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSignedIn } from '@/lib/session';
import { storage } from '@/lib/storage';
import { useSeason } from '@/lib/use-season';
import { firstMomentPlays, firstSeenKey, type FirstKind } from './firsts';

/** Which orders were the person's first meal and first tuktuk (`orders.firsts`), read fresh when asked. */
export function useOrderFirsts() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.orders.firsts.queryOptions(), enabled: signedIn, staleTime: 0 });
}

/**
 * Decides once per kind whether the «أول مرة» moment plays here, and marks it played on this phone.
 * Null while unknown (no kind yet, or the phone's memory not read yet).
 */
function useFirstOnce(kind: FirstKind | null): boolean | null {
  const today = useSeason();
  const [decided, setDecided] = useState<{ kind: FirstKind; plays: boolean } | null>(null);
  useEffect(() => {
    if (!kind || decided?.kind === kind) return;
    let live = true;
    void (async () => {
      const seen = (await storage.getItem(firstSeenKey(kind)).catch(() => null)) !== null;
      const plays = firstMomentPlays({ kind, seen, celebrations: today.celebrations });
      if (plays) await storage.setItem(firstSeenKey(kind), String(Date.now())).catch(() => undefined); // at worst it shows again once
      if (live) setDecided({ kind, plays });
    })();
    return () => {
      live = false;
    };
    // Decided once per kind; a quiet day switched on mid-moment changes nothing already shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  return decided && decided.kind === kind ? decided.plays : null;
}

const LINE: Record<FirstKind, 'firsts.food' | 'firsts.tuktuk' | 'firsts.rajaa'> = { food: 'firsts.food', tuktuk: 'firsts.tuktuk', rajaa: 'firsts.rajaa' };
const GLYPH = { food: 'food', tuktuk: 'tuktuk-fringe', rajaa: 'rajaa' } as const;

/**
 * «أول مرة» (joy g8): a saffron stamp and one warm line, once in a lifetime per first — «أول طلب إلك
 * ويانا، بالعافية». It pops in (still under reduced motion); `haptic` adds a success buzz where the
 * screen has none of its own (the الرجعة pass; the arrival screen already buzzes). Hidden on quiet days.
 */
export function FirstMoment({ kind, haptic = false }: { kind: FirstKind | null; haptic?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const presets = useMotionPresets();
  const plays = useFirstOnce(kind);
  useEffect(() => {
    if (plays && haptic) theme.haptic('success');
    // Once, when it starts playing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plays]);
  if (!plays || !kind) return null;
  return (
    <Animated.View entering={presets.pop()} testID={`first-${kind}`} accessibilityLiveRegion="polite" style={{ alignSelf: 'stretch' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          padding: theme.space[3],
          borderRadius: theme.radius.xl,
          backgroundColor: theme.colors.surface,
          borderWidth: 1.5,
          borderColor: theme.colors.deal,
        }}
      >
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: theme.colors.deal, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={GLYPH[kind]} size={26} color="onDeal" strokeWidth={2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" weight={700} color="textMuted">
            {t('firsts.stamp')}
          </Text>
          <Text variant="bodyStrong">{t(LINE[kind])}</Text>
        </View>
      </View>
    </Animated.View>
  );
}
