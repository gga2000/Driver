export { PromotionsModule } from './promotions.module.js';
export { PromotionsService, projectDeal, dealState, dealView, PROJECTION_BASIS_DAYS } from './promotions.service.js';
export type { OrderSample, DealProposal } from './promotions.service.js';
export { PROMOTIONS_REPOSITORY, InMemoryPromotionsRepository, PrismaPromotionsRepository } from './promotions.repository.js';
export type { PromotionsRepository, DealRecord, DealProjection } from './promotions.repository.js';
export { bestDeal, nextDeal, evaluateDeal, dealIsLive, dealBadge, budgetLeft, allocateIqd, inDealHours } from './deal-pricing.js';
export type { Basket, BasketLine, DealOutcome } from './deal-pricing.js';
