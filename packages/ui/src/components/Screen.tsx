import { useRef, useState, type ReactElement, type ReactNode, type Ref } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type RefreshControlProps, type StyleProp, type ViewStyle } from 'react-native';
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
  /** Decoration behind everything (home's sky and paper grain): fills the screen under the status bar, never takes a touch. */
  backdrop?: ReactNode;
  testID?: string;
}

/** Max column width so the phone layout stays a phone layout on a tablet or desktop browser. */
export const MAX_CONTENT_WIDTH = 560;

/**
 * Every app screen sits in this: cream background, safe areas, one centred column. The content is
 * the page's `main` landmark on the web.
 */
export function Screen({ children, scroll = true, padded = true, edges = ['top'], footer, refreshControl, contentStyle, scrollRef, backdrop, testID }: ScreenProps) {
  const theme = useTheme();
  // A pinned footer draws a hairline only while content continues under it, so a card cut at the
  // scroll edge reads as "more below" instead of a stray sliver above the button.
  const edge = useRef({ viewport: 0, content: 0, offset: 0 });
  const [moreBelow, setMoreBelow] = useState(false);
  const measure = (patch: Partial<typeof edge.current>) => {
    if (!footer) return;
    const e = Object.assign(edge.current, patch);
    setMoreBelow(e.content - (e.offset + e.viewport) > 1);
  };
  const column: ViewStyle = {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: padded ? theme.space[5] : 0,
  };
  return (
    <SafeAreaView testID={testID} edges={edges} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      {backdrop ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {backdrop}
        </View>
      ) : null}
      {scroll ? (
        <ScrollView
          ref={scrollRef}
          role="main"
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
          scrollEventThrottle={32}
          onLayout={(e: LayoutChangeEvent) => measure({ viewport: e.nativeEvent.layout.height })}
          onContentSizeChange={(_w: number, h: number) => measure({ content: h })}
          onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => measure({ offset: e.nativeEvent.contentOffset.y })}
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
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: theme.colors.bg, borderTopWidth: 1, borderTopColor: scroll && moreBelow ? theme.colors.border : 'transparent' }}>
          <View style={[column, { paddingVertical: theme.space[3] }]}>{footer}</View>
        </SafeAreaView>
      ) : null}
    </SafeAreaView>
  );
}
