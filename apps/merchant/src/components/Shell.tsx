import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge, Text, useTheme } from '@driver/ui';
import type { Section } from '@/lib/guard';
import { useT, type TKey } from '@/lib/i18n';
import { MIcon, type MIconName } from './MIcon';

export interface NavItem {
  section: Section;
  href: '/' | '/menu' | '/money' | '/more';
  label: TKey;
  icon: MIconName;
}

/**
 * The four tabs in reading order (start → end), counter step 5 (g1): الطلبات · المنيو · يومك · المحل.
 * يومك holds the day, the owner's money and the numbers; المحل holds the shutter and the shop's settings.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { section: 'orders', href: '/', label: 'merchant.nav.orders', icon: 'receipt' },
  { section: 'menu', href: '/menu', label: 'merchant.nav.menu', icon: 'utensils' },
  { section: 'money', href: '/money', label: 'merchant.nav.day', icon: 'chart' },
  { section: 'more', href: '/more', label: 'merchant.nav.shop', icon: 'store' },
];

export interface ShellNavProps {
  items: readonly NavItem[];
  active: Section | null;
  /** New orders waiting: badge on الطلبات. */
  newCount: number;
  onNavigate: (item: NavItem) => void;
}

/**
 * Tablet / wide web: a rail on the start side (the right in RTL), always visible, so the kitchen
 * switches between the board and the menu in one tap without losing the board's alarm.
 */
export function NavRail({ items, active, newCount, onNavigate }: ShellNavProps) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        width: 92,
        backgroundColor: theme.colors.surface,
        borderEndWidth: 1,
        borderEndColor: theme.colors.border,
        paddingTop: Math.max(insets.top, theme.space[4]),
        paddingBottom: Math.max(insets.bottom, theme.space[4]),
        alignItems: 'center',
        gap: theme.space[2],
      }}
    >
      <View
        accessibilityLabel={t('merchant.app_name')}
        style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: theme.space[4] }}
      >
        <Text weight={700} style={{ fontSize: 26, lineHeight: 36, color: theme.colors.onAccent }}>
          د
        </Text>
      </View>
      {items.map((item) => {
        const focused = active === item.section;
        return (
          <Pressable
            key={item.section}
            testID={`nav-${item.section}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={t(item.label)}
            onPress={() => {
              if (!focused) theme.haptic('selection');
              onNavigate(item);
            }}
            style={({ pressed }) => ({ width: 80, alignItems: 'center', gap: 4, paddingVertical: theme.space[2], opacity: pressed ? 0.7 : 1 })}
          >
            <View
              style={{
                width: 56,
                height: 36,
                borderRadius: theme.radius.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: focused ? theme.colors.accentTint : 'transparent',
              }}
            >
              <MIcon name={item.icon} size={24} color={focused ? 'accentText' : 'textMuted'} strokeWidth={focused ? 2.1 : 1.75} />
              {item.section === 'orders' && newCount > 0 ? <Badge count={newCount} tone="danger" style={{ position: 'absolute', top: -4, end: 4 }} /> : null}
            </View>
            <Text variant="caption" weight={focused ? 700 : 500} color={focused ? 'text' : 'textMuted'} numberOfLines={1}>
              {t(item.label)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Phone: bottom tabs on section roots. */
export function BottomBar({ items, active, newCount, onNavigate }: ShellNavProps) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        backgroundColor: theme.colors.surface,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        paddingBottom: Math.max(insets.bottom, theme.space[2]),
        paddingTop: theme.space[2],
      }}
    >
      {items.map((item) => {
        const focused = active === item.section;
        return (
          <Pressable
            key={item.section}
            testID={`tab-${item.section}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={t(item.label)}
            onPress={() => {
              if (!focused) theme.haptic('selection');
              onNavigate(item);
            }}
            style={{ flex: 1, alignItems: 'center', gap: 2, minHeight: theme.hitTarget }}
          >
            <View style={{ width: 56, height: 30, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? theme.colors.accentTint : 'transparent' }}>
              <MIcon name={item.icon} size={22} color={focused ? 'accentText' : 'textMuted'} strokeWidth={focused ? 2.1 : 1.75} />
              {item.section === 'orders' && newCount > 0 ? <Badge count={newCount} tone="danger" style={{ position: 'absolute', top: -4, end: 6 }} /> : null}
            </View>
            <Text variant="caption" weight={focused ? 600 : 500} color={focused ? 'text' : 'textMuted'} numberOfLines={1}>
              {t(item.label)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
