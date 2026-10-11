export { ShoppingModule } from './shopping.module.js';
export { ShoppingService, SHOP_TAG, shopKindOf } from './shopping.service.js';
export { DailyBreadSweeper, dailyBreadSweepMs } from './daily-bread.sweeper.js';
export {
  SHOPPING_REPOSITORY,
  InMemoryShoppingRepository,
  PrismaShoppingRepository,
} from './shopping.repository.js';
export type { ShoppingRepository, DayPostRecord, DailyBreadRecord } from './shopping.repository.js';
export { DEMO_MARKET_SHOPS, seedDemoShops, type DemoMarketShop } from './seed.js';
