/**
 * The new customer home's pieces (docs/specs/2026-11-01-home-redesign.md §12), a subpath of its own so
 * the partner and merchant apps never carry them.
 */
export { HomeMapCard, LiveTag, type HomeMapCardProps } from './HomeMapCard';
export { CalmPanel, OffersPanel, OrderPanel, type CalmPanelProps, type HomeDish, type OffersPanelProps, type OrderPanelProps } from './panels';
export { LiveBoard, type BoardService, type Departure, type LiveBoardProps } from './LiveBoard';
export { PointsPill, RiverLine } from './bits';
export { BigDishCard, CompactDish, HomeCard, HomeChips, RestaurantCard, UsualCard, type BigDishCardProps, type CompactDishProps, type HomeCardDish, type HomeChip, type HomeChipsProps, type RestaurantCardProps, type UsualCardProps } from './cards';
export { DishCardSkeleton, HomeMapCardSkeleton, LiveBoardSkeleton, RestaurantRowSkeleton } from './skeletons';
export { HomePress, Picture, type DishPicture, type HomePressProps, type PictureProps } from './media';
export { useHomeLook, countWord } from './look';
export { liveAge, mealKey, mealWindow, panelMode, riverFill, stageRuns, trackerSteps, type LiveAge, type Meal, type OrderStage, type PanelMode, type PanelModeInput, type TrackerStep } from './logic';
