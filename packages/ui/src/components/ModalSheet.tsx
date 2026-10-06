import { createContext, useContext, type ReactNode, type RefObject } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '@driver/i18n';
import { useTheme } from '../theme/ThemeProvider';
import { IconButton } from './IconButton';
import { Text } from './Text';

/** From this window width up, `layout="auto"` draws a centred dialog instead of a bottom sheet. */
export const MODAL_DIALOG_MIN_WIDTH = 900;

export interface ModalSheetProps {
  visible: boolean;
  /** Close request: scrim tap, the close button, Android back, Escape on web. Ignored while `locked`. */
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Node at the end of the header (a ring, a pill). */
  aside?: ReactNode;
  /** Node at the start of the header, before the title (a dish photo, a service tile). */
  leading?: ReactNode;
  /**
   * A full-width picture above the title (the dish sheet's 16:9 hero, joy o2). With a hero the title
   * scrolls with the body, so a tall sheet gives the choices the room.
   */
  hero?: ReactNode;
  /** The body's scroll view, for jumping to a part of it (a missing required choice, joy o4). */
  scrollRef?: RefObject<ScrollView | null>;
  children: ReactNode;
  /** Pinned under the scrolling body: the primary action, where the thumb finds it. */
  footer?: ReactNode;
  /** Dialog width on wide screens: md 560 px, lg 720 px. */
  size?: 'md' | 'lg';
  /** Busy (uploading, saving): nothing closes it until it unlocks. */
  locked?: boolean;
  /** The ✕ in the header (default on). */
  closeButton?: boolean;
  /** `auto`: bottom sheet on phones, centred dialog from 900 px; or force one. */
  layout?: 'auto' | 'sheet' | 'dialog';
  /** Widest a bottom sheet gets (phone column on a tablet/desktop browser); full width when unset. */
  sheetMaxWidth?: number;
  /** Spoken name of the scrim and the ✕ ("سد"); apps with their own copy pass theirs. */
  closeLabel?: string;
  testID?: string;
}

/** What an app can set once for every `ModalSheet` under it (props on a sheet still win). */
export type ModalSheetDefaults = Partial<Pick<ModalSheetProps, 'closeLabel' | 'layout' | 'sheetMaxWidth' | 'closeButton'>>;

const ModalSheetDefaultsContext = createContext<ModalSheetDefaults>({});

/**
 * App-wide sheet defaults — the Merchant app's "سكّر" close label, for one — so screens use the shared
 * `ModalSheet` directly instead of keeping a local wrapper.
 */
export function ModalSheetDefaultsProvider({ value, children }: { value: ModalSheetDefaults; children: ReactNode }) {
  return <ModalSheetDefaultsContext.Provider value={value}>{children}</ModalSheetDefaultsContext.Provider>;
}

/**
 * The one modal sheet (S-12): an RN `Modal`, so focus can't wander into the screen behind it —
 * `accessibilityViewIsModal` on iOS, Android back closes it, and on the web react-native-web traps
 * focus inside a `role="dialog"` and closes on Escape. The scrim is a button named "سد" (not the
 * title). A grabber on phones, a ✕ in the header, a scrolling body and a pinned footer; enters with
 * the sheet spring (a fade under reduced motion is skipped altogether).
 */
export function ModalSheet({
  visible,
  onClose,
  title,
  subtitle,
  aside,
  leading,
  hero,
  scrollRef,
  children,
  footer,
  size = 'md',
  locked = false,
  closeButton: closeButtonProp,
  layout: layoutProp,
  sheetMaxWidth: sheetMaxWidthProp,
  closeLabel: closeLabelProp,
  testID,
}: ModalSheetProps) {
  const theme = useTheme();
  const defaults = useContext(ModalSheetDefaultsContext);
  const closeButton = closeButtonProp ?? defaults.closeButton ?? true;
  const layout = layoutProp ?? defaults.layout ?? 'auto';
  const sheetMaxWidth = sheetMaxWidthProp ?? defaults.sheetMaxWidth;
  const closeLabel = closeLabelProp ?? defaults.closeLabel;
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const dialog = layout === 'dialog' || (layout === 'auto' && width >= MODAL_DIALOG_MIN_WIDTH);
  const maxW = dialog ? (size === 'lg' ? 720 : 560) : sheetMaxWidth;
  const dismiss = () => {
    if (!locked) onClose();
  };
  const close = closeLabel ?? t('ui.dismiss');
  const hasHeader = Boolean(title || subtitle || aside || leading || closeButton);
  const header = hasHeader ? (
    <View style={{ flexDirection: 'row', alignItems: leading ? 'flex-start' : 'center', gap: theme.space[3], paddingHorizontal: theme.space[5], paddingTop: theme.space[dialog ? 5 : 3], paddingBottom: theme.space[3] }}>
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <Text variant="heading" accessibilityRole="header" numberOfLines={2} testID={testID ? `${testID}-title` : undefined}>
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text variant="footnote" color="textMuted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {aside}
      {closeButton && !locked ? <IconButton icon="x" variant="tonal" accessibilityLabel={close} onPress={dismiss} testID={testID ? `${testID}-close` : undefined} /> : null}
    </View>
  ) : (
    <View style={{ height: theme.space[3] }} />
  );

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: dialog ? 'center' : 'flex-end', alignItems: 'center', padding: dialog ? theme.space[6] : 0 }}>
          <Animated.View
            entering={theme.reduceMotion ? undefined : FadeIn.duration(theme.motion.duration.fast)}
            style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: theme.colors.scrim }}
          >
            <Pressable testID={testID ? `${testID}-scrim` : undefined} accessibilityRole="button" accessibilityLabel={close} onPress={dismiss} style={{ flex: 1 }} />
          </Animated.View>
          <Animated.View
            entering={theme.reduceMotion ? undefined : dialog ? FadeInDown.duration(theme.motion.duration.base) : SlideInDown.springify().damping(theme.motion.spring.sheet.damping).stiffness(theme.motion.spring.sheet.stiffness)}
            testID={testID}
            accessibilityViewIsModal
            aria-modal
            style={{
              width: '100%',
              maxWidth: maxW,
              maxHeight: height * (dialog ? 0.9 : 0.92),
              backgroundColor: theme.colors.surfaceRaised,
              borderRadius: theme.radius['2xl'],
              borderBottomStartRadius: dialog ? theme.radius['2xl'] : 0,
              borderBottomEndRadius: dialog ? theme.radius['2xl'] : 0,
              overflow: 'hidden',
              paddingBottom: footer || dialog ? 0 : insets.bottom,
              shadowColor: theme.colors.shadow,
              shadowOpacity: 0.18,
              shadowRadius: 30,
              shadowOffset: { width: 0, height: 10 },
              elevation: 12,
            }}
          >
            {!dialog ? (
              <View style={{ alignItems: 'center', paddingTop: theme.space[2] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.colors.border }} />
              </View>
            ) : null}
            {hero ? null : header}
            <ScrollView ref={scrollRef} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: theme.space[5], paddingBottom: theme.space[footer ? 4 : 5], gap: theme.space[4] }} keyboardShouldPersistTaps="handled">
              {hero ? (
                <View style={{ marginHorizontal: -theme.space[5], marginTop: theme.space[2] }}>
                  {hero}
                  <View style={{ marginBottom: -theme.space[4] }}>{header}</View>
                </View>
              ) : null}
              {children}
            </ScrollView>
            {footer ? (
              <View
                style={{
                  paddingHorizontal: theme.space[5],
                  paddingTop: theme.space[3],
                  paddingBottom: Math.max(theme.space[4], dialog ? 0 : insets.bottom),
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
