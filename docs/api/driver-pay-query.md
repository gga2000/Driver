# «عندي اعتراض» — the driver's pay question and support's answer (2026-10-06)

Partner audit S-7 (`docs/research/ui-ux-audit/partner.md`). The receipt's «عندي اعتراض» opens a
`complaint` ticket in the Console queue (`driverAccount.payQuery`, one per driver and job, source key
`driver_pay:<driverId>:<jobKey>`). This closes the loop back to the driver.

## Opening
- `driverAccount.payQuery({ key, at, message })` — unchanged; the ticket's `opened` entry now also keeps
  the job's time (`meta.jobAt`) so a later push can open the receipt.

## Support answers (Console)
- `support.reply` (not internal) emits `support.replied`; `support.resolve` emits `support.resolved`
  (payload now carries `resolution`). On a driver pay query both payloads add
  `{ driverId, jobKey, jobAt }`.
- Notify (`notify.subscribers.ts`): `support.replied` → template `driver_pay_reply` («الدعم ردّ على
  اعتراضك», body = the reply, one line, ≤ 140 chars); `support.resolved` → `driver_pay_resolved`
  («اعتراضك انحل», body = the resolution). Partner app, push only, sent in quiet hours too. Deep link
  `driver-partner://earnings/receipt?key=<jobKey>&at=<jobAt>` (the receipt). Customer tickets (no
  `driverId`) produce nothing here.

## The receipt (`driverAccount.jobReceipt`)
- `queryOpen` as before, plus `query: { ticketId, status: 'open' | 'resolved', reply: { text, at } | null,
  resolution, resolvedAt } | null`: `reply` is support's latest reply to him (internal notes never),
  `resolution` and `resolvedAt` only once resolved.
- Partner app (`QueryStatus` in `ReceiptParts.tsx`): «اعتراضك على هذا الطلب» with a «دا نراجعه» /
  «انحلت» pill, «ردّ الدعم: …», «الحل: …»; before any reply «وصل اعتراضك للدعم، نرد عليك خلال 24 ساعة».

## Demo
- Partner: `POST /demo/pay-query?who=courier&step=open|reply|resolve` (`scripts/demo/55-pay-query.mjs`).
