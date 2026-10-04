// Theme
export { ThemeProvider, useTheme, createTheme, fontStyle } from './theme/ThemeProvider';
export type { Theme, ThemeProviderProps, HapticKind, HapticHandler, Direction, FontMode } from './theme/ThemeProvider';
export { resolveColor, withAlpha, type ColorValue } from './theme/color';

// Icons
export { Icon, type IconProps } from './icons/Icon';
export { ICONS, ICON_NAMES, MIRRORED, type IconName } from './icons/paths';

// Motion
export { usePressScale, useSelectSpring, usePulse, AnimatedPressable } from './motion/motion';
export { useCountUp } from './motion/useCountUp';

// Components
export { Text, type TextProps } from './components/Text';
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './components/Button';
export { IconButton, type IconButtonProps, type IconButtonVariant } from './components/IconButton';
export { Chip, ChipGroup, nextChipSelection, type ChipProps, type ChipGroupProps, type ChipGroupItem } from './components/Chip';
export { Avatar, toneFor, initialOf, type AvatarProps, type AvatarTone } from './components/Avatar';
export { Card, type CardProps } from './components/Card';
export { ListRow, type ListRowProps } from './components/ListRow';
export { PriceLine, PriceBreakdown, type PriceLineProps, type PriceBreakdownProps } from './components/PriceBreakdown';
export { Rule, type RuleProps } from './components/Rule';
export { Sheet, type SheetProps } from './components/Sheet';
export { Stepper, clampStep, type StepperProps } from './components/Stepper';
export { SegmentedControl, type SegmentedControlProps, type SegmentOption } from './components/SegmentedControl';
export { TextField, SearchField, type TextFieldProps, type SearchFieldProps } from './components/TextField';
export { Badge, type BadgeProps } from './components/Badge';
export { StatusPill, STATUS_TONES, type StatusPillProps, type StatusTone } from './components/StatusPill';
export { Timeline, stepStates, type TimelineProps, type TimelineStep, type StepState } from './components/Timeline';
export { SeatMap, SeatLegend, type SeatMapProps } from './components/SeatMap';
export { CountdownRing, type CountdownRingProps } from './components/CountdownRing';
export { EmptyState, type EmptyStateProps } from './components/EmptyState';
export { Skeleton, type SkeletonProps } from './components/Skeleton';
export { Toast, ToastProvider, useToast, type ToastProps, type ToastData } from './components/Toast';
export { StatusBanner, bannerDismissible, type StatusBannerProps, type BannerSeverity } from './components/StatusBanner';
export { OfflineBanner, type OfflineBannerProps, type OfflineBannerLabels } from './components/OfflineBanner';
export { RetryState, type RetryStateProps, type RetryKind } from './components/RetryState';
export { StaleNote, type StaleNoteProps } from './components/StaleNote';

// Network awareness (offline strip, skeleton timeouts, React Query wiring)
export {
  bindOnlineManager,
  configureNetwork,
  getNetwork,
  networkFetch,
  retryKindFor,
  useConnectionBanner,
  useLoadTimeout,
  useNetwork,
  useNow,
  type ConnectionBannerState,
  type NetworkStatus,
} from './network/network';
export { agoText, type AgoT } from './network/ago';

// Logic and formatting (pure, shared with server-rendered receipts and tests)
export * from './logic/seats';
export * from './logic/price';
export * from './logic/countdown';
export * from './logic/sheet';
export * from './format';
