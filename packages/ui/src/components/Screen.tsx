import type { ReactElement, ReactNode, Ref } from 'react';
import { ScrollView, View, type RefreshControlProps, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

export interface ScreenProps {
  children: ReactNode;
  /** Scrolls by default; pass false for screens that manage their own layout (forms with a pinned footer). */
  scroll?: boolean;
  /** Horizontal gutter (20 px) and vertical rhythm. */
  padded?: boolean;
  edges?: Edge[];
  /** Pinned under the scroll area (primary button); respects the bottom safe area. */
  footer?: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
  contentStyle?: StyleProp<ViewStyle>;
  /** The scroll view, for screens that jump to a section (home → food rails). */
  scrollRef?: Ref<ScrollView>;
  testID?: string;
}

/** Max column width so the phone layout stays a phone layout on a tablet or desktop browser. */
export const MAX_CONTENT_WIDTH = 560;

/**
 * Every app screen sits in this: cream background, safe areas, one centred column. The content is
 * the page's `main` landmark on the web.
 */
export function Screen({ children, scroll = true, padded = true, edges = ['top'], footer, refreshControl, contentStyle, scrollRef, testID }: ScreenProps) {
  const theme = useTheme();
  const column: ViewStyle = {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: padded ? theme.space[5] : 0,
  };
  return (
    <SafeAreaView testID={testID} edges={edges} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      {scroll ? (
        <ScrollView
          ref={scrollRef}
          role="main"
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
          contentContainerStyle={[column, { paddingTop: theme.space[3], paddingBottom: theme.space[10], gap: theme.space[6] }, contentStyle]}
        >
          {children}
        </ScrollView>
      ) : (
        <View role="main" style={[{ flex: 1 }, column, contentStyle]}>
          {children}
        </View>
      )}
      {footer ? (
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: theme.colors.bg }}>
          <View style={[column, { paddingVertical: theme.space[3] }]}>{footer}</View>
        </SafeAreaView>
      ) : null}
    </SafeAreaView>
  );
}
