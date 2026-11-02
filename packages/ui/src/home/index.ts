/**
 * The new customer home's pieces (docs/specs/2026-11-01-home-redesign.md §12), a subpath of its own so
 * the partner and merchant apps never carry them.
 */
export { HomeMapCard, LiveTag, type HomeMapCardProps } from './HomeMapCard';
export { CalmPanel, OffersPanel, OrderPanel, type CalmPanelProps, type DishPicture, type HomeDish, type OffersPanelProps, type OrderPanelProps } from './panels';
export { LiveBoard, type BoardService, type Departure, type LiveBoardProps } from './LiveBoard';
export { PointsPill, RiverLine } from './bits';
export { useHomeLook, countWord } from './look';
export * from './logic';
