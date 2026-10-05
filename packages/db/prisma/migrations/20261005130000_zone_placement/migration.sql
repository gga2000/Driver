-- Zone placement tool (maps program SP3, approved by Ali 2026-10-05): outlines drawn on a real map in
-- the Console replace the AI-drafted hexagons. `placement` is draft | placed | confirmed; the seed never
-- overwrites an outline that is not a draft. Additive: existing rows stay drafts.
ALTER TABLE "public"."zones"
  ADD COLUMN "centre" geography(Point, 4326),
  ADD COLUMN "placement" TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN "placed_at" TIMESTAMP(3),
  ADD COLUMN "placed_by_id" TEXT;
