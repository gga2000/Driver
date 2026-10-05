import { Modal, Pressable, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { MAX_CONTENT_WIDTH } from './Screen';
import { Text } from './Text';

export interface PermissionPromptPoint {
  icon: IconName;
  label: string;
}

export interface PermissionPromptProps {
  visible: boolean;
  /** "notifications" → bell, "location" → pin, or any icon. */
  icon?: IconName;
  title: string;
  body: string;
  /** What the person gets, one line each (optional). */
  points?: readonly PermissionPromptPoint[];
  allowLabel: string;
  laterLabel: string;
  /** Opens the OS prompt. */
  onAllow: () => void;
  /** Snoozes (scrim tap, back button and Escape count as "later"). */
  onLater: () => void;
  busy?: boolean;
  testID?: string;
}

/**
 * Our own ask before the OS permission prompt (the OS one can be shown once; a "no" there is
 * forever): a bottom sheet saying what the person gets, in Iraqi Arabic, with one big "allow" and
 * a quiet "later". Push and location pre-prompts in every app use it. Modal semantics as
 * `ModalSheet`: focus stays inside, back/Escape/scrim mean "later".
 */
export function PermissionPrompt({ visible, icon = 'bell', title, body, points, allowLabel, laterLabel, onAllow, onLater, busy = false, testID = 'push-preprompt' }: PermissionPromptProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onLater} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
        <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(theme.motion.duration.fast)} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: theme.colors.scrim }}>
          <Pressable accessibilityRole="button" accessibilityLabel={laterLabel} onPress={onLater} style={{ flex: 1 }} />
        </Animated.View>
        <Animated.View
          testID={testID}
          accessibilityViewIsModal
          aria-modal
          entering={theme.reduceMotion ? undefined : SlideInDown.springify().damping(theme.motion.spring.sheet.damping).stiffness(theme.motion.spring.sheet.stiffness)}
          style={{
            width: '100%',
            maxWidth: MAX_CONTENT_WIDTH,
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            paddingHorizontal: theme.space[5],
            paddingTop: theme.space[6],
            paddingBottom: Math.max(theme.space[8], insets.bottom + theme.space[4]),
            gap: theme.space[4],
          }}
        >
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
            <Icon name={icon} size={30} color="accentText" />
          </View>
          <View style={{ gap: theme.space[2] }}>
            <Text variant="heading" align="center" accessibilityRole="header">
              {title}
            </Text>
            <Text variant="body" color="textMuted" align="center">
              {body}
            </Text>
          </View>
          {points && points.length > 0 ? (
            <View style={{ gap: theme.space[3], paddingVertical: theme.space[2] }}>
              {points.map((p) => (
                <View key={p.label} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                  <View style={{ width: 36, height: 36, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={p.icon} size={18} color="text" />
                  </View>
                  <Text variant="label" style={{ flex: 1 }}>
                    {p.label}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          <Button testID={`${testID}-allow`} label={allowLabel} size="lg" fullWidth loading={busy} onPress={onAllow} />
          <Button testID={`${testID}-later`} label={laterLabel} variant="ghost" size="lg" fullWidth onPress={onLater} />
        </Animated.View>
      </View>
    </Modal>
  );
}
