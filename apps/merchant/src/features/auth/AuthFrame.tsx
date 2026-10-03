import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconButton, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';

/**
 * Frame for the sign-in steps: full screen on a phone; on a tablet a centred 480-px card on the cream
 * background (a kitchen tablet is landscape and wide — a phone form stretched across it looks broken).
 */
export function AuthFrame({ title, subtitle, back = true, children, footer, testID }: { title: string; subtitle?: string; back?: boolean; children: ReactNode; footer?: ReactNode; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const { wide } = useLayout();
  const body = (
    <View style={{ gap: theme.space[6] }}>
      <View style={{ gap: theme.space[5] }}>
        <View style={{ flexDirection: 'row', minHeight: 44 }}>
          {back ? (
            <IconButton icon="chevron-back" variant="outline" accessibilityLabel={t('action.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))} />
          ) : null}
        </View>
        <View style={{ gap: theme.space[1] }}>
          <Text variant="heading" accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? (
            <Text variant="body" color="textMuted">
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {children}
    </View>
  );
  if (wide) {
    return (
      <SafeAreaView testID={testID} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space[8] }} keyboardShouldPersistTaps="handled">
          <View style={{ width: '100%', maxWidth: 480, backgroundColor: theme.colors.surface, borderRadius: theme.radius['2xl'], padding: theme.space[8], gap: theme.space[6], borderWidth: 1, borderColor: theme.colors.border, shadowColor: theme.colors.shadow, shadowOpacity: 0.08, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } }}>
            {body}
            {footer}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView testID={testID} edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: theme.space[5], paddingTop: theme.space[3], paddingBottom: theme.space[6] }} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
      {footer ? <View style={{ paddingHorizontal: theme.space[5], paddingVertical: theme.space[3] }}>{footer}</View> : null}
    </SafeAreaView>
  );
}
