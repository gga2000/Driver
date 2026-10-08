import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useId, type ReactNode } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Icon, MAX_CONTENT_WIDTH, Text, useTheme, withAlpha } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { OrderTicket } from './OrderTicket';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro bundles assets through require()
const STREET_SOFT = require('../../../assets/welcome/golden-street-soft.webp') as number;

/** Sign-in has three steps: the number, the code, the name and door. */
export const AUTH_STEPS = 3;

export interface AuthStageProps {
  step: 1 | 2 | 3;
  /** White first line of the headline. */
  title: string;
  /** Saffron second line. */
  accent?: string;
  subtitle?: ReactNode;
  /** Back is router.back() unless overridden; false hides it (setup cannot go back to the code). */
  back?: boolean;
  onBack?: () => void;
  /** The guest's waiting basket on top (he came here from "كمّل الطلب"). */
  ticket?: boolean;
  /** The cream sheet's content. */
  children: ReactNode;
  /** Pinned at the bottom of the sheet (the main button, the small print). */
  footer?: ReactNode;
  testID?: string;
}

/**
 * The frame of the sign-in screens (Ali 2026-10-08: "Golden sheet" with D's order card). The welcome's
 * street stays behind, softly blurred under a date-brown veil, so leaving the welcome never feels like
 * a different app. On top: back, three saffron step bars and, when a basket waits, its ticket; then
 * the headline; and a cream sheet rises from the bottom with the one thing this step asks for.
 */
export function AuthStage({ step, title, accent, subtitle, back = true, onBack, ticket = false, children, footer, testID }: AuthStageProps) {
  const theme = useTheme();
  const t = useT();
  const night = theme.colors.inverse;
  // A short phone (360×640) gives the sheet the room: a smaller headline.
  const short = useWindowDimensions().height < 700;
  const headline = short ? { fontSize: 26, lineHeight: 36 } : { fontSize: 32, lineHeight: 42 };
  // One id per mounted screen: the stack keeps the phone screen under the code screen, and on the web
  // a gradient id shared with a hidden screen paints nothing (the code screen lost its veil).
  const veilId = `auth-veil-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const column = { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' } as const;
  const goBack = () => (onBack ? onBack() : router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <View testID={testID} style={{ flex: 1, overflow: 'hidden', backgroundColor: night }}>
      <StatusBar style="light" />
      <Image source={STREET_SOFT} resizeMode="cover" aria-hidden accessible={false} style={{ position: 'absolute', top: 0, start: 0, width: '100%', height: '100%' }} />
      <View pointerEvents="none" style={StyleSheet.absoluteFill} aria-hidden accessible={false}>
        <Svg width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id={veilId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset={0} stopColor={night} stopOpacity={0.55} />
              <Stop offset={0.45} stopColor={night} stopOpacity={0.35} />
              <Stop offset={1} stopColor={night} stopOpacity={0.8} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${veilId})`} />
        </Svg>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView role="main" bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
          <SafeAreaView edges={['top']} style={[column, { paddingHorizontal: theme.space[5], paddingTop: theme.space[2], gap: theme.space[5] }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
              {back ? (
                <Pressable
                  testID="auth-back"
                  accessibilityRole="button"
                  accessibilityLabel={t('action.back')}
                  onPress={goBack}
                  style={({ pressed }) => ({
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: withAlpha(theme.colors.onInverse, pressed ? 0.24 : 0.14),
                  })}
                >
                  <Icon name="chevron-back" size={22} color="onInverse" />
                </Pressable>
              ) : (
                <View />
              )}
              <StepBars step={step} />
            </View>
            {ticket ? <OrderTicket /> : null}
            <View style={{ gap: theme.space[2], paddingTop: ticket || short ? 0 : theme.space[4] }}>
              <Text accessibilityRole="header" weight={700} color="onInverse" maxFontSizeMultiplier={1.3} style={headline}>
                {title}
                {accent ? (
                  <>
                    {'\n'}
                    <Text weight={700} color="onInverseAccent" maxFontSizeMultiplier={1.3} style={headline}>
                      {accent}
                    </Text>
                  </>
                ) : null}
              </Text>
              {subtitle ? (
                typeof subtitle === 'string' ? (
                  <Text color={withAlpha(theme.colors.onInverse, 0.84)} style={{ fontSize: 15, lineHeight: 24 }}>
                    {subtitle}
                  </Text>
                ) : (
                  subtitle
                )
              ) : null}
            </View>
          </SafeAreaView>

          <View style={{ flexGrow: 1, minHeight: theme.space[8] }} />

          <View
            style={{
              backgroundColor: theme.colors.bg,
              borderTopStartRadius: theme.radius['2xl'],
              borderTopEndRadius: theme.radius['2xl'],
            }}
          >
            <View style={[column, { paddingHorizontal: theme.space[5], paddingTop: theme.space[6], paddingBottom: footer ? theme.space[2] : theme.space[3], gap: theme.space[5] }]}>{children}</View>
          </View>
        </ScrollView>
        {/* The main button stays in reach however long the sheet is (the name and place step scrolls). */}
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: theme.colors.bg }}>
          {footer ? <View style={[column, { paddingHorizontal: theme.space[5], paddingTop: theme.space[2], paddingBottom: theme.space[3] }]}>{footer}</View> : null}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Three short saffron bars: done and current lit, the rest faint. Read as "الخطوة 2 من 3". */
function StepBars({ step }: { step: number }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      testID="auth-steps"
      accessible
      accessibilityLabel={t('auth.step_a11y', { step, total: AUTH_STEPS })}
      style={{ flexDirection: 'row', gap: 6 }}
    >
      {Array.from({ length: AUTH_STEPS }, (_, i) => (
        <View
          key={i}
          style={{
            width: 22,
            height: 4,
            borderRadius: 2,
            backgroundColor: i < step ? theme.colors.onInverseAccent : withAlpha(theme.colors.onInverse, 0.3),
          }}
        />
      ))}
    </View>
  );
}
