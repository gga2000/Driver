import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { AZIZIYAH_ZONES } from '@driver/contracts';
import { Button, ChipGroup, Text, TextField, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { zoneName, type PlaceLabel, type SavedPlace } from '@/lib/profile';
import { placeIcon } from './place-icon';

export type PlaceDraft = Omit<SavedPlace, 'id'>;

export const EMPTY_PLACE: PlaceDraft = { label: 'home', zoneId: '', note: '' };

const LABELS: readonly PlaceLabel[] = ['home', 'work', 'family', 'other'];
const LABEL_KEY = {
  home: 'onboarding.place_label_home',
  work: 'onboarding.place_label_work',
  family: 'onboarding.place_label_family',
  other: 'onboarding.place_label_other',
} as const;

export function placeLabelKey(label: PlaceLabel) {
  return LABEL_KEY[label];
}

/** Centre and near zones first: that's where most orders go. "كل المناطق" shows all 34. */
const COMMON_ZONES = AZIZIYAH_ZONES.filter((z) => z.tier === 'centre' || z.tier === 'near');

/**
 * Saved-place form (label, zone, courier note). Zone-level for now; the map pin and gate photo
 * arrive with the maps milestone (TODO: pin picker + `places.save` API).
 */
export function PlaceForm({ value, onChange }: { value: PlaceDraft; onChange: (next: PlaceDraft) => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const [allZones, setAllZones] = useState(false);
  const zones = useMemo(() => {
    const list = allZones ? AZIZIYAH_ZONES : COMMON_ZONES;
    // Keep a chosen far zone visible after collapsing.
    const chosen = AZIZIYAH_ZONES.find((z) => z.id === value.zoneId);
    return chosen && !list.includes(chosen) ? [...list, chosen] : list;
  }, [allZones, value.zoneId]);

  return (
    <View style={{ gap: theme.space[6] }}>
      <View style={{ gap: theme.space[3] }}>
        <Text variant="title">{t('onboarding.place_label')}</Text>
        <ChipGroup
          accessibilityLabel={t('onboarding.place_label')}
          mode="single"
          required
          value={[value.label]}
          onChange={(next) => onChange({ ...value, label: (next[0] as PlaceLabel | undefined) ?? value.label })}
          items={LABELS.map((l) => ({ id: l, label: t(LABEL_KEY[l]), icon: placeIcon(l) }))}
        />
      </View>

      <View style={{ gap: theme.space[3] }}>
        <Text variant="title">{t('onboarding.place_zone')}</Text>
        <ChipGroup
          accessibilityLabel={t('onboarding.place_zone')}
          mode="single"
          value={value.zoneId ? [value.zoneId] : []}
          onChange={(next) => onChange({ ...value, zoneId: next[0] ?? '' })}
          items={zones.map((z) => ({ id: z.id, label: zoneName(z.id, locale) }))}
        />
        <Button
          variant="ghost"
          size="sm"
          icon={allZones ? 'minus' : 'plus'}
          label={allZones ? t('onboarding.place_fewer_zones') : t('onboarding.place_more_zones')}
          onPress={() => setAllZones((v) => !v)}
        />
      </View>

      <TextField
        label={t('cart.note_courier')}
        value={value.note ?? ''}
        onChangeText={(note) => onChange({ ...value, note })}
        placeholder={t('onboarding.place_note_placeholder')}
        hint={t('onboarding.place_hint')}
        multiline
      />
    </View>
  );
}
