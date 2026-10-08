-- Private car round 2 step 6, Ali's item 56 (rules s1–s4): the booker of a private car shares it by a
-- link; friends pay their places from their wallets. Ids and amounts only: names stay in the vault.

-- AlterTable
ALTER TABLE "public"."ride_requests" ADD COLUMN     "share_booker_places" INTEGER,
ADD COLUMN     "share_code" TEXT,
ADD COLUMN     "share_opened_at" TIMESTAMP(3),
ADD COLUMN     "share_place_iqd" INTEGER,
ADD CONSTRAINT "ride_requests_share_check" CHECK (
  ("share_code" IS NULL AND "share_booker_places" IS NULL AND "share_place_iqd" IS NULL AND "share_opened_at" IS NULL)
  OR ("share_code" IS NOT NULL AND "share_booker_places" >= 1 AND "share_place_iqd" >= 0 AND "share_opened_at" IS NOT NULL)
);

-- CreateTable
CREATE TABLE "public"."ride_request_shares" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "places" INTEGER NOT NULL,
    "amount_iqd" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'joined',
    "joined_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ride_request_shares_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ride_request_shares_state_check" CHECK ("state" IN ('joined', 'left', 'released', 'paid')),
    CONSTRAINT "ride_request_shares_places_check" CHECK ("places" BETWEEN 1 AND 6),
    CONSTRAINT "ride_request_shares_amount_check" CHECK ("amount_iqd" >= 0)
);

-- CreateIndex
CREATE INDEX "ride_request_shares_request_id_idx" ON "public"."ride_request_shares"("request_id");

-- CreateIndex
CREATE INDEX "ride_request_shares_person_id_state_idx" ON "public"."ride_request_shares"("person_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ride_requests_share_code_key" ON "public"."ride_requests"("share_code");

-- AddForeignKey
ALTER TABLE "public"."ride_request_shares" ADD CONSTRAINT "ride_request_shares_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."ride_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

SELECT * FROM "public"."driver_harden"(ARRAY['public', 'identity_vault'], 'identity_vault');
