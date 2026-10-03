import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton, Text, useTheme, withAlpha } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';

export interface ModalSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Node at the end of the header (a ring, a pill). */
  aside?: ReactNode;
  children: ReactNode;
  /** Pinned under the scrolling body: the primary action. */
  footer?: ReactNode;
  /** Wide dialogs: md 560 px, lg 720 px. */
  size?: 'md' | 'lg';
  testID?: string;
}

/**
 * Modal for kitchen decisions (accept, reject, close, busy, order detail): a bottom sheet on a phone,
 * a centred dialog on a tablet. Backdrop tap and the close button dismiss; the action sits pinned at
 * the bottom where a thumb (or a floury finger) finds it.
 */
export function ModalSheet({ visible, onClose, title, subtitle, aside, children, footer, size = 'md', testID }: ModalSheetProps) {
  const theme = useTheme();
  const t = useT();
  const { wide, height } = useLayout();
  const insets = useSafeAreaInsets();
  const maxW = size === 'lg' ? 720 : 560;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: wide ? 'center' : 'flex-end', alignItems: 'center', padding: wide ? theme.space[6] : 0 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('merchant.common.close')}
            onPress={onClose}
            style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: withAlpha(theme.colors.text, 0.42) }}
          />
          <Animated.View
            entering={theme.reduceMotion ? undefined : FadeInDown.duration(220)}
            testID={testID}
            accessibilityViewIsModal
            style={{
              width: '100%',
              maxWidth: wide ? maxW : undefined,
              maxHeight: wide ? height * 0.9 : height * 0.92,
              backgroundColor: theme.colors.surfaceRaised,
              borderRadius: theme.radius['2xl'],
              borderBottomStartRadius: wide ? theme.radius['2xl'] : 0,
              borderBottomEndRadius: wide ? theme.radius['2xl'] : 0,
              overflow: 'hidden',
              shadowColor: theme.colors.shadow,
              shadowOpacity: 0.18,
              shadowRadius: 30,
              shadowOffset: { width: 0, height: 10 },
              elevation: 12,
            }}
          >
            {!wide ? (
              <View style={{ alignItems: 'center', paddingTop: theme.space[2] }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.colors.border }} />
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[5], paddingTop: theme.space[wide ? 5 : 3], paddingBottom: theme.space[3] }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="heading" accessibilityRole="header" numberOfLines={2}>
                  {title}
                </Text>
                {subtitle ? (
                  <Text variant="footnote" color="textMuted">
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              {aside}
              <IconButton icon="x" variant="tonal" accessibilityLabel={t('merchant.common.close')} onPress={onClose} testID={testID ? `${testID}-close` : undefined} />
            </View>
            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: theme.space[5], paddingBottom: theme.space[4], gap: theme.space[4] }} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
            {footer ? (
              <View
                style={{
                  paddingHorizontal: theme.space[5],
                  paddingTop: theme.space[3],
                  paddingBottom: Math.max(theme.space[4], wide ? 0 : insets.bottom),
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border,
                  backgroundColor: theme.colors.surfaceRaised,
                  gap: theme.space[2],
                }}
              >
                {footer}
              </View>
            ) : null}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
