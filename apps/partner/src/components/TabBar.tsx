import type { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, Text, useTheme, type IconName } from '@driver/ui';
import { MAX_CONTENT_WIDTH } from './Screen';

/** expo-router's Tabs `tabBar` props (react-navigation's BottomTabBarProps). */
export type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

export interface TabSpec {
  /** Route name inside app/(tabs). */
  name: string;
  label: string;
  icon: IconName;
}

/**
 * Bottom tab bar drawn with @driver/ui icons and type. Order follows the route order, which in
 * RTL puts الرئيسية on the right edge (the reading start) on native and web alike.
 */
export function TabBar({ state, navigation, tabs }: TabBarProps & { tabs: readonly TabSpec[] }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        backgroundColor: theme.colors.surface,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        paddingBottom: Math.max(insets.bottom, theme.space[2]),
        paddingTop: theme.space[2],
      }}
    >
      <View style={{ flexDirection: 'row', width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' }}>
        {state.routes.map((route, index) => {
          const spec = tabs.find((t) => t.name === route.name);
          if (!spec) return null;
          const focused = state.index === index;
          const color = focused ? 'accentText' : 'textMuted';
          return (
            <Pressable
              key={route.key}
              testID={`tab-${spec.name}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={spec.label}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) {
                  theme.haptic('selection');
                  navigation.navigate(route.name, route.params);
                }
              }}
              style={{ flex: 1, alignItems: 'center', gap: 2, minHeight: theme.hitTarget }}
            >
              <View
                style={{
                  width: 56,
                  height: 30,
                  borderRadius: theme.radius.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: focused ? theme.colors.accentTint : 'transparent',
                }}
              >
                <Icon name={spec.icon} size={22} color={color} strokeWidth={focused ? 2.1 : 1.75} />
              </View>
              <Text variant="caption" weight={focused ? 600 : 500} color={focused ? 'text' : 'textMuted'}>
                {spec.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
