export { PromotionsModule } from './promotions.module.js';
export { PromotionsService, projectDeal, dealState, dealView, PROJECTION_BASIS_DAYS } from './promotions.service.js';
export type { OrderSample, DealProposal } from './promotions.service.js';
export { PROMOTIONS_REPOSITORY, InMemoryPromotionsRepository, PrismaPromotionsRepository } from './promotions.repository.js';
export type { PromotionsRepository, DealRecord, DealProjection } from './promotions.repository.js';
