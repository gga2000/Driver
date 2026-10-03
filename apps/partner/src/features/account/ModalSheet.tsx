import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, useTheme } from '@driver/ui';
import { MAX_CONTENT_WIDTH } from '@/components/Screen';

/**
 * A modal bottom sheet for short tasks (the hand-over code, uploading a document): scrim, a grabber,
 * a title and the body, sliding up from the bottom. Tapping the scrim closes it unless `locked`.
 */
export function ModalSheet({ visible, onClose, title, children, locked = false, testID }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode; locked?: boolean; testID?: string }) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => (locked ? undefined : onClose())} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(160)} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: theme.colors.scrim }}>
          <Pressable accessibilityRole="button" accessibilityLabel={title} style={{ flex: 1 }} onPress={() => (locked ? undefined : onClose())} />
        </Animated.View>
        <Animated.View
          testID={testID}
          entering={theme.reduceMotion ? undefined : SlideInDown.springify().damping(22).stiffness(220)}
          style={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius['2xl'], borderTopRightRadius: theme.radius['2xl'] }}
        >
          <SafeAreaView edges={['bottom']}>
            <View style={{ alignItems: 'center', paddingTop: theme.space[2] }}>
              <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.colors.border }} />
            </View>
            <View style={{ padding: theme.space[5], paddingTop: theme.space[3], gap: theme.space[4] }}>
              {title ? (
                <Text variant="heading" accessibilityRole="header">
                  {title}
                </Text>
              ) : null}
              {children}
            </View>
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}
