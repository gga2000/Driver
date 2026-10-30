# Kitchen ticket and customer slip («الريل») — print redesign

Ali, 2026-10-08: yes to all 32 ideas and the recommended answer of the six calls in
`/merchant-redesign/print/print.html` (k1 a customer slip in every bag; k2 every dish + delivery fee +
total, all from the server; k3 restaurant name big, «درايفر» small; k4 the pickup code on the bag
stub; k5 58 mm and 80 mm both supported, shops buy their own printers; k6 no QR code yet).

## Server: `merchant.board` → `BoardOrder.bill` (additive)

The slip prints only amounts the server sent. Each board order now carries

```ts
bill?: { itemsIqd, deliveryFeeIqd, serviceFeeIqd, smallOrderFeeIqd, discountIqd, pointsIqd, changeIqd, totalIqd }
```

copied from the order's own fields (`billOf` in `apps/api/src/modules/merchant/board.ts`; nothing is
recomputed). `items + delivery + service + smallOrder − discount − points + change = total`.
Absent on a gift whose sender hid the prices, and on an older API (the slip then prints the dishes
and the order total only).

## App (apps/merchant/src/print)

- `kitchen.ts` kitchen ticket + bag stub, «تعديل» ticket, station tickets + packing, cup labels;
  `slip.ts` customer slip, gift card, the «اطبع مسطرة» ruler; `plan.ts` what one order prints and when;
  `doc-html.ts` the true-size print page (carries its fonts); `features/print/PaperDoc.tsx` the same
  papers on screen; `escpos.ts` the bytes for the tablet's Bluetooth printer (raster, beep, cut).
- Device-local: printer settings (`settings.ts`) and the print log (`journal.ts`: copy count for
  «نسخة ثانية», what was printed for the «تعديل» ticket).
- Shots: `node apps/merchant/scripts/print-shots.mjs <out>` (every paper at 58 and 80 mm, 8 dots/mm)
  and `SHOTS=print node apps/merchant/scripts/web-shots.mjs <out>` (the printer screen).

## Follow-ups (server, not built here)

- Print count on the server, so «نسخة ثانية» is true across every tablet of a store (today: per device).
- The pickup code exists only once a courier has the trip (`pickupCodeFor(order, courier)`): a ticket
  printed before that shows a blank «رمز الاستلام» box; a reprint after the courier is assigned has it.
- The gift sender's own line (i23) never reaches the server by design; the card says «بطلب من شخص يحبك».
- Stations use the shop's menu sections (picked in the printer settings); a per-item station tag on the
  menu would make it exact.
- A real allergy field on the order (today the board's `mentionsAllergy` rule on the notes).
