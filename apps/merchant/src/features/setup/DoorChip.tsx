import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';
import type { FoodDoor } from '@driver/contracts';
import { Text, useTheme } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { LIBRARY } from '@/features/menu/library-data';
import { COUNTER } from '@/lib/counter';
import { useT, type TKey } from '@/lib/i18n';

/** A library dish that stands for each door on its tile. */
const DOOR_DISH: Readonly<Record<FoodDoor, string>> = { meal: 'kebab', cafe: 'tea', cold: 'orange-juice', sweet: 'kunafa' };

/**
 * k4: each kind in the customer app's door colours, from the shared theme (the customer doors read the
 * same tokens): meals saffron, cafés date brown, cold drinks gold, sweets the sunset rose.
 */
export function useDoorColour(door: FoodDoor): { fill: string; on: string } {
  const theme = useTheme();
  const { food, trips, back } = theme.services;
  switch (door) {
    case 'meal':
      return { fill: food.fill, on: food.on };
    case 'cafe':
      return { fill: trips.fill, on: trips.on };
    case 'cold':
      return { fill: back.fill, on: back.on };
    case 'sweet':
      return { fill: theme.decor.wash.sunset, on: theme.colors.text };
  }
}

/** The shop's kind as a small coloured tag (the preview, the board card). */
export function DoorChip({ door, small = false }: { door: FoodDoor; small?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const c = useDoorColour(door);
  return (
    <View testID={`door-chip-${door}`} style={{ height: small ? 28 : 32, paddingHorizontal: theme.space[3], borderRadius: theme.radius.pill, justifyContent: 'center', backgroundColor: c.fill }}>
      <Text variant="caption" weight={700} style={{ color: c.on }} numberOfLines={1}>
        {t(`merchant.setup.door_${door}` as TKey)}
      </Text>
    </View>
  );
}

/** «شنو تبيع؟»: one door as a big tile — its colour, a photo of what it sells, a check when picked. */
export function DoorTile({ door, selected, onPress }: { door: FoodDoor; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  const c = useDoorColour(door);
  const photo = LIBRARY.find((d) => d.slug === DOOR_DISH[door])?.photos[0];
  return (
    <Pressable
      testID={`setup-door-${door}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={t(`merchant.setup.door_${door}` as TKey)}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        minHeight: 84,
        padding: theme.space[3],
        borderRadius: theme.radius.xl,
        borderWidth: selected ? 3 : 1,
        borderColor: selected ? COUNTER.saffron : theme.colors.border,
        backgroundColor: COUNTER.paper,
        opacity: pressed ? 0.88 : 1,
      })}
    >
      <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? COUNTER.ready : 'transparent', borderWidth: selected ? 0 : 2, borderStyle: 'dashed', borderColor: theme.colors.borderStrong }}>
        {selected ? <MIcon name="check" size={18} color={COUNTER.onDate} strokeWidth={2.6} /> : null}
      </View>
      <Text variant="bodyStrong" style={{ flex: 1, fontSize: 17, lineHeight: 26 }}>
        {t(`merchant.setup.door_${door}` as TKey)}
      </Text>
      <View style={{ width: 76, height: 60, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: c.fill, padding: 4 }}>
        {photo !== undefined ? <Image source={photo} contentFit="cover" style={{ flex: 1, borderRadius: theme.radius.md }} /> : null}
      </View>
    </Pressable>
  );
}
