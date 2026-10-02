# Driver (درايفر) — Money & Ops Spec

Date: 2026-10-02 · Status: approved — Plan 2 complete, Q1–Q6. All amounts IQD; every figure here is config per city/zone, not code.

## 1. Restaurant commission
Tiered by what the merchant receives: 12% base listing · 15% featured placement · 18% marketing deals. 5% on pickup orders. Lower tiers conditional on price parity (in-app price = in-store price). Customer service fee: fixed 500 per order, shown as its own line.

## 2. Delivery fees and courier pay (food, grocery)
Delivery fees pass through to the courier in full.

| Band | Customer pays | Courier earns | Platform keeps |
|---|---|---|---|
| Near (< 1.5 km) | 500 | 500 | 0 |
| Mid (1.5–4 km) | 1,000 | 1,000 | 0 |
| Far (4 km+) | 1,500–2,000 by zone | 1,500 | 0–500 |
| Street-point handover | −250 | −250 | 0 |
| Door pickup (errands, parcels) | +500 | +500 | 0 |

Rules: small-order fee +500 on orders under 5,000 (own line); batched second order pays the courier 70% of its fee, customer pays full; night +250, rain +250 as named components; pickup compensation when pickup is more than 2 km from the courier; cars doing food +500. Launch guarantee: 10,000 per 4-hour peak shift at ≥ 85% acceptance, topped up by platform; switches off per zone when average shift earnings exceed it.

Worked example, 15,000 order across town: commission 2,250 + service fee 500 = 2,750 to platform; courier 1,000; restaurant 12,750.

## 3. Rides, seats, parcels: platform take
| Service | Platform take | Driver keeps |
|---|---|---|
| Tuktuk in city | 10% (min 100) | 90% |
| Car in city | 12% | 88% |
| Intercity seat | 10% | 90% |
| Front seat premium (+2,000) | 25% | 75% |
| Private intercity car | 8% | 92% |
| Khat seat (monthly) | 8% + 1,000 fixed | rest |
| Parcel in city | 15% | 85% |
| Parcel intercity (trunk) | 15% | 85% |
| Late meters, cancel fees, penalties | 0% | 100% to the wronged party |
Take rates are shown openly to drivers. Fare tables themselves are set in Plan 3 from real Aziziyah prices.

## 4. Cash and settlement
Channels: (1) field-ops cash round with WhatsApp receipt; (2) ZainCash to company wallet, auto-matched by amount + driver ID; (3) agent shops accepting driver settlements and customer wallet top-ups for a small fee.
Credit caps: 75,000 new · 150,000 Silver · 300,000 Gold. Over cap: finish current job, no new offers, WhatsApp with nearest settlement option.
Restaurant payouts: weekly (Sunday), `merchant_payable` netted against commission, via ZainCash or ops round, WhatsApp PDF statement per order; daily payout at Gold tier.
Nightly close at 02:00: ledger invariant; morning WhatsApp to every driver (jobs, earnings, owed, cap remaining); discrepancies open incidents; finance screen shows cash in field / due / collected per driver. Driver earnings live in Partner with every component named.

## 5. Promotions funding
Platform promos draw from a monthly marketing budget set in the Console with auto-stop caps and live spend-vs-incremental-orders. Merchant promos are deducted from weekly payouts, with projected cost shown before publishing. Launch package (months 1–2): free delivery on first 3 orders, referral 2,000 points both sides, courier shift guarantees; budget ~10M for two months. No permanent free delivery; a subscription (~3,000/month: free near deliveries, free door pickup, peak priority) ships with the wallet. Abuse: one first-order offer per device + phone + home-place fingerprint; codes single-use per account unless flagged campaign.

## 6. Cost base and break-even
Team: 2 dispatcher/support (shifts 10:00–24:00) + 1 field ops + Ali; restaurant photography in-house.
Run rate after month 2: ~3.5–4M/month before promotions (staff ~2.4M, infrastructure and messaging 0.5–0.8M). One-off legal/registration/stores/accountant 1–2M.
Revenue per order: ~2,750 food, ~300 tuktuk ride, ~1,000 Baghdad seat.
Break-even: ~1,300 food orders/month (~45/day), fewer with intercity seats. Six-month runway target 25–30M including the launch budget. Levers if smaller: one dispatcher with Ali covering evenings, lower shift guarantees, shorter free-delivery window.
