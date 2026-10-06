// Theme
export { ThemeProvider, useTheme, createTheme, fontStyle, faceStyle } from './theme/ThemeProvider';
export type { Theme, ThemeProviderProps, HapticKind, HapticHandler, Direction, FontMode } from './theme/ThemeProvider';
export { resolveColor, withAlpha, type ColorValue } from './theme/color';

// Icons
export { Icon, type IconProps } from './icons/Icon';
export { ICONS, ICON_NAMES, MIRRORED, type IconName } from './icons/paths';

// Illustration: the Aziziyah sketchbook (joy J4)
export { SKETCH } from './art/kit';
export { DishDrawing, DISH_KINDS, DISH_LOOKS, type DishKind, type DishDrawingProps } from './art/dishes';
export { SketchScene, SCENE_NAMES, type SceneName, type SceneVehicle, type SketchSceneProps } from './art/SketchScene';
export { STICKERS, STICKER_PACK, type StickerArt, type StickerSpec } from './art/stickers';

// Motion
export { usePressScale, useSelectSpring, usePulse, AnimatedPressable } from './motion/motion';
export { useCountUp } from './motion/useCountUp';
export { digitRoll, fadeIn, hop, panelIn, pop, sheetIn, staggerDelay, useMotionPresets, type MotionTokens, type PresetOptions } from './motion/presets';

// Components
export { Text, type TextProps } from './components/Text';
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './components/Button';
export { IconButton, type IconButtonProps, type IconButtonVariant } from './components/IconButton';
export { Chip, ChipGroup, nextChipSelection, type ChipProps, type ChipGroupProps, type ChipGroupItem } from './components/Chip';
export { Avatar, toneFor, identityIndex, initialOf, type AvatarProps, type AvatarTone } from './components/Avatar';
export { Card, type CardProps } from './components/Card';
export { DataSaverCard } from './components/DataSaverCard';
export { ListRow, type ListRowProps } from './components/ListRow';
export { PriceLine, PriceBreakdown, ChangeToWallet, type PriceLineProps, type PriceBreakdownProps } from './components/PriceBreakdown';
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
export { SlideToConfirm, type SlideToConfirmProps, type SlideTone } from './components/SlideToConfirm';
export { CountdownButton, type CountdownButtonProps } from './components/CountdownButton';
export { ModalSheet, MODAL_DIALOG_MIN_WIDTH, type ModalSheetProps } from './components/ModalSheet';
export { OtpInput, otpValue, type OtpInputProps } from './components/OtpInput';
export { Screen, MAX_CONTENT_WIDTH, type ScreenProps } from './components/Screen';
export { TabBar, type TabBarProps, type TabSpec, type TabBarNavigationProps } from './components/TabBar';
export { PermissionPrompt, type PermissionPromptProps, type PermissionPromptPoint } from './components/PermissionPrompt';
export { ChatThread, useMaskedCall, type ChatThreadProps, type ChatThreadQuery, type ChatT, type ChatPhotoResult } from './components/ChatThread';
export { DriverChip, PlateChip, type DriverChipProps, type PlateChipProps } from './components/DriverChip';
export { SosButton, SosSheet, type SosButtonProps, type SosSheetProps, type SosSheetPhase } from './components/SosButton';

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
export { DATA_SAVER_PREFS, LITE_REFRESH_FACTOR, liteFor, liteInterval, setDataSaverPref, useDataSaver, useLiteMode, type DataSaverPref } from './network/data-saver';

// Logic and formatting (pure, shared with server-rendered receipts and tests)
export * from './logic/seats';
export * from './logic/price';
export * from './logic/countdown';
export * from './logic/sheet';
export * from './logic/slide';
export * from './logic/chat';
export * from './logic/plate';
export * from './logic/sos';
export * from './logic/photo-fallback';
export * from './logic/voice';
export * from './format';

// Phase 3 "الخردة علينا" (cash at the door): the big-key amount pad.
export { AmountPad, amountPadNext, AMOUNT_PAD_KEYS, type AmountPadProps, type AmountPadKey } from './components/AmountPad';
// Phase 3 — Partner money moments (end of job, shift summary)
export { SegmentRing, type SegmentRingProps } from './components/SegmentRing';
export { ringArcs, RING_MAX_SEGMENTS, type RingArc } from './logic/ring';
// Phase 3 · garage board (customer audit d-2): the departure-board time
export { DepartureTime, type DepartureTimeProps, type DepartureTimeSize, type DepartureTimeTone } from './components/DepartureTime';
export * from './logic/departure';
// Phase 3 (brief E): app-wide ModalSheet defaults, so apps drop their local ModalSheet wrappers.
export { ModalSheetDefaultsProvider, type ModalSheetDefaults } from './components/ModalSheet';
