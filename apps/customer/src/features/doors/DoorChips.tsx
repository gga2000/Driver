import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import Svg, { G } from 'react-native-svg';
import type { FoodDoor } from '@driver/contracts';
import { Text, useTheme } from '@driver/ui';
import { DishDrawing } from '@driver/ui/dishes';
import { useT } from '@/lib/i18n';
import { DOOR_ART } from './doors';
import { doorSwatch } from './palette';

const ART = 44;

/**
 * The four doors small, two by two (search's start screen, f3): each a pill in its door's colour with
 * its drawing and name. Same doors, same colours, same order as the food home.
 */
export function DoorChips({
  order,
  testID = 'door-chips',
}: {
  order: readonly FoodDoor[];
  testID?: string;
}) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID={testID} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
      {order.map((door) => {
        const s = doorSwatch(theme, door);
        return (
          <Pressable
            key={door}
            testID={`${testID}-${door}`}
            accessibilityRole="button"
            accessibilityLabel={t(`food.door.${door}`)}
            onPress={() => router.push({ pathname: '/food/[door]', params: { door } })}
            style={({ pressed }) => ({
              flexBasis: '48%',
              flexGrow: 1,
              minHeight: 56,
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[2],
              paddingStart: theme.space[1],
              paddingEnd: theme.space[3],
              borderRadius: theme.radius.pill,
              backgroundColor: s.fill,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Svg width={ART} height={ART} viewBox="0 0 200 200">
              <G transform="translate(8 6) scale(0.92)">
                <DishDrawing kind={DOOR_ART[door]} look={0} line={6} window={false} />
              </G>
            </Svg>
            <Text
              variant="label"
              weight={700}
              numberOfLines={1}
              style={{ color: s.on, flexShrink: 1 }}
            >
              {t(`food.door.${door}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
