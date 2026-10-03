import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconButton, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';

export interface PageProps {
  title: string;
  subtitle?: string;
  /** Back button to the parent (deeper screens: printer, a menu item…). Section roots leave it off. */
  back?: boolean;
  /** Node at the end of the header row (a pill, a button). */
  aside?: ReactNode;
  children: ReactNode;
  /** Scrolls by default; false for screens that lay themselves out (lists with their own scroll). */
  scroll?: boolean;
  /** Content column width on a tablet. */
  maxWidth?: number;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Frame for every screen except the board: cream background, a header with the title (and back),
 * and one centred column — 720 px on a tablet so forms and lists don't stretch across the screen.
 * Wave-2 screens (menu, money, insights, deals, staff) build inside it.
 */
export function Page({ title, subtitle, back, aside, children, scroll = true, maxWidth = 760, contentStyle, testID }: PageProps) {
  const theme = useTheme();
  const t = useT();
  const { wide } = useLayout();
  const column: ViewStyle = { width: '100%', maxWidth, alignSelf: 'center', paddingHorizontal: wide ? theme.space[8] : theme.space[5] };
  const header = (
    <View style={[column, { flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingTop: theme.space[wide ? 6 : 3], paddingBottom: theme.space[4] }]}>
      {back ? (
        <IconButton icon="chevron-back" variant="outline" accessibilityLabel={t('action.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/more'))} />
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant={wide ? 'display' : 'heading'} accessibilityRole="header" numberOfLines={1} style={wide ? { fontSize: 28, lineHeight: 42 } : undefined}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" color="textMuted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {aside}
    </View>
  );
  return (
    <SafeAreaView testID={testID} edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      {header}
      {scroll ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={[column, { paddingBottom: theme.space[10], gap: theme.space[5] }, contentStyle]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, column, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}
