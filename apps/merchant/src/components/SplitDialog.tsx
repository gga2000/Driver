import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { IconButton, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';

/**
 * d23 · a tablet dialog in two panes: the order on the start side (its header, its body scrolling, its
 * footer pinned) and a side panel at the end side — the chat about that order — so the conversation
 * opens next to the ticket instead of on a full, mostly empty page. The same scrim, radius and Escape /
 * back-to-close as the app's ModalSheet; it fades in once (none with reduce motion).
 */
export function SplitDialog({
  title,
  subtitle,
  aside,
  footer,
  side,
  onClose,
  children,
  testID,
}: {
  title: string;
  subtitle?: string;
  aside?: ReactNode;
  footer?: ReactNode;
  /** The end-side panel (fills its height). */
  side: ReactNode;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  const t = useT();
  const { width, height } = useWindowDimensions();
  const close = t('merchant.common.close');
  const sideWidth = Math.min(440, Math.round(width * 0.38));
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space[6] }}>
        <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(theme.motion.duration.fast)} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: theme.colors.scrim }}>
          <Pressable accessibilityRole="button" accessibilityLabel={close} onPress={onClose} style={{ flex: 1 }} />
        </Animated.View>
        <Animated.View
          entering={theme.reduceMotion ? undefined : FadeIn.duration(theme.motion.duration.base)}
          testID={testID}
          accessibilityViewIsModal
          aria-modal
          style={{
            width: '100%',
            maxWidth: 1200,
            height: height * 0.9,
            flexDirection: 'row',
            backgroundColor: theme.colors.surfaceRaised,
            borderRadius: theme.radius['2xl'],
            overflow: 'hidden',
            shadowColor: theme.colors.shadow,
            shadowOpacity: 0.18,
            shadowRadius: 30,
            shadowOffset: { width: 0, height: 10 },
            elevation: 12,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[5], paddingTop: theme.space[5], paddingBottom: theme.space[3] }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="heading" accessibilityRole="header" numberOfLines={2} testID={testID ? `${testID}-title` : undefined}>
                  {title}
                </Text>
                {subtitle ? (
                  <Text variant="footnote" color="textMuted">
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              {aside}
              <IconButton icon="x" variant="tonal" accessibilityLabel={close} onPress={onClose} testID={testID ? `${testID}-close` : undefined} />
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: theme.space[5], paddingBottom: theme.space[4], gap: theme.space[4] }} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
            {footer ? <View style={{ paddingHorizontal: theme.space[5], paddingVertical: theme.space[3], borderTopWidth: 1, borderTopColor: theme.colors.border, gap: theme.space[2] }}>{footer}</View> : null}
          </View>
          <View testID={testID ? `${testID}-side` : undefined} style={{ width: sideWidth, borderStartWidth: 1, borderStartColor: theme.colors.border, backgroundColor: theme.colors.bg }}>
            {side}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
