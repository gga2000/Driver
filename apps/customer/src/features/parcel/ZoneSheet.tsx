import { useMemo, useState } from 'react';
import { ScrollView } from 'react-native';
import { Button, ChipGroup, Text, useTheme } from '@driver/ui';
import { BottomPanel } from '@/features/track/Panels';
import { useLocale, useT } from '@/lib/i18n';
import { zoneName } from '@/lib/profile';
import { useLiveZones } from '@/lib/zones-live';

/** The town and its near ring first (where nearly every door is); «كل المناطق» opens the rest. */
const isCommon = (z: { tier: string }) => z.tier === 'centre' || z.tier === 'near';

/**
 * «وين ساكن المستلم؟»: the receiver's area. The server prices the parcel to it, and the receiver's own pin
 * later has to land where the fare is the same.
 */
export function ZoneSheet({ value, onPick, onClose }: { value: string | null; onPick: (zoneKey: string) => void; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const zones = useLiveZones();
  const [all, setAll] = useState(() => Boolean(value && !zones.some((z) => isCommon(z) && z.id === value)));
  const items = useMemo(() => (all ? zones : zones.filter(isCommon)).map((z) => ({ id: z.id, label: zoneName(z.id, locale) })), [all, zones, locale]);
  return (
    <BottomPanel onClose={onClose} testID="parcel-zone-sheet">
      <Text variant="heading">{t('parcel.c_area_title')}</Text>
      <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: theme.space[3] }}>
        <ChipGroup accessibilityLabel={t('parcel.c_area_title')} mode="single" items={items} value={value ? [value] : []} onChange={(next) => (next[0] ? onPick(next[0]) : undefined)} />
      </ScrollView>
      {!all ? <Button label={t('onboarding.place_more_zones')} variant="ghost" fullWidth onPress={() => setAll(true)} testID="parcel-zone-more" /> : null}
    </BottomPanel>
  );
}
