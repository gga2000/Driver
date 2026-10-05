import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { useTheme } from '../theme/ThemeProvider';
import { Badge } from './Badge';
import { MAX_CONTENT_WIDTH } from './Screen';
import { Text } from './Text';

/**
 * The slice of react-navigation's `BottomTabBarProps` the bar uses, so expo-router's
 * `<Tabs tabBar={(p) => <TabBar {...p} tabs={…} />}>` passes straight through without this
 * package depending on the router.
 */
export interface TabBarNavigationProps {
  state: { index: number; routes: ReadonlyArray<{ key: string; name: string; params?: object }> };
  navigation: {
    emit: (e: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean };
    navigate: (name: string, params?: object) => void;
  };
}

export interface TabSpec {
  /** Route name inside app/(tabs). */
  name: string;
  label: string;
  icon: IconName;
  /** Unread or waiting count on the icon (0 hides it). */
  badge?: number;
}

export type TabBarProps = TabBarNavigationProps & { tabs: readonly TabSpec[] };

/**
 * Bottom tab bar drawn with @driver/ui icons and type: an accent pill behind the active icon, 44 px
 * targets, `tablist`/`tab` roles. Order follows the route order, which in RTL puts الرئيسية on the
 * right edge (the reading start) on native and web alike.
 */
export function TabBar({ state, navigation, tabs }: TabBarProps) {
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
          const badge = spec.badge ?? 0;
          return (
            <Pressable
              key={route.key}
              testID={`tab-${spec.name}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              aria-selected={focused}
              accessibilityLabel={badge > 0 ? `${spec.label} · ${badge}` : spec.label}
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
                {badge > 0 ? <Badge count={badge} style={{ position: 'absolute', top: -4, end: 6 }} /> : null}
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
