import { router } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconButton, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { revealOffset, type Span } from '@/lib/reveal';

/** What a screen inside a scrolling Page can ask of its scroll area. */
export interface PageScroll {
  /** The visible scroll area in window coordinates; null until it is laid out. */
  viewport: Span | null;
  /** Scrolls so `node` is in view (centred); nothing when it already is. */
  reveal(node: View): void;
}

const PageScrollContext = createContext<PageScroll | null>(null);

/** The surrounding Page's scroll area (null outside a scrolling Page, e.g. the board). */
export function usePageScroll(): PageScroll | null {
  return useContext(PageScrollContext);
}

/** Scroll events at most every other frame: only the latest offset is kept, for `reveal`. */
const SCROLL_EVENT_THROTTLE_MS = 32;

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
  const scrollRef = useRef<ScrollView>(null);
  // The scroll area's frame, measured on a plain View (ScrollView's typings don't expose measuring).
  const frameRef = useRef<View>(null);
  const offset = useRef(0);
  const [viewport, setViewport] = useState<Span | null>(null);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
  }, []);
  const measureViewport = useCallback(() => {
    frameRef.current?.measureInWindow((_x, y, _w, height) => setViewport((v) => (v && v.top === y && v.height === height ? v : { top: y, height })));
  }, []);
  const reveal = useCallback((node: View) => {
    const sv = scrollRef.current;
    const frame = frameRef.current;
    if (!sv || !frame) return;
    frame.measureInWindow((_vx, vy, _vw, vh) => {
      node.measureInWindow((_x, y, _w, h) => {
        const next = revealOffset({ top: y, height: h }, { top: vy, height: vh }, offset.current);
        if (next !== null) sv.scrollTo({ y: next, animated: true });
      });
    });
  }, []);
  const scrollApi = useMemo<PageScroll>(() => ({ viewport, reveal }), [viewport, reveal]);
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
        // The phone's "3 طلبات تنتظر" strip is docked above the tab bar (MerchantRuntime), so nothing floats over the last row.
        <View ref={frameRef} style={{ flex: 1 }} onLayout={measureViewport}>
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={[column, { paddingBottom: theme.space[10], gap: theme.space[5] }, contentStyle]}
            keyboardShouldPersistTaps="handled"
            onScroll={onScroll}
            scrollEventThrottle={SCROLL_EVENT_THROTTLE_MS}
          >
            <PageScrollContext.Provider value={scrollApi}>{children}</PageScrollContext.Provider>
          </ScrollView>
        </View>
      ) : (
        <View style={[{ flex: 1 }, column, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}
