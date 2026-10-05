-- Phase 3 "الخردة علينا" (UI/UX audit customer d-1, partner S-2; 2026-10-05, awaiting Ali's final OK).
-- cash_change_to_wallet: the courier had no change, took the customer's whole note and the rest went to
-- the customer's wallet — its own ledger line, apart from cash_rounding_credit (the 0–249 rounding).
-- orders.stated_tender_iqd: the note the customer said he will pay with (a hint for the courier).
-- orders.change_to_wallet_iqd: what went to the wallet at the door. Both additive and nullable; no new
-- table, so no driver_harden call.
ALTER TYPE "public"."LedgerEventType" ADD VALUE IF NOT EXISTS 'cash_change_to_wallet';

ALTER TABLE "public"."orders" ADD COLUMN "stated_tender_iqd" INTEGER,
ADD COLUMN "change_to_wallet_iqd" INTEGER;
