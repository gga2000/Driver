-- M3 food ordering: the customer catalog read. Additive: storefront facts on the menu (cuisine line,
-- tags, photo, minimum order, prep, opening hours, rating placeholder) and menu sections on items.
-- Existing menus keep '{}' (no storefront: not listed to customers) and items keep no section.
ALTER TABLE "public"."catalogs" ADD COLUMN "storefront" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "public"."catalog_items" ADD COLUMN "category_ar" TEXT;
ALTER TABLE "public"."catalog_items" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
