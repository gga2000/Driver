# WhatsApp Business templates (to submit for approval)

Date: 2026-10-04. Source of truth: `NOTIFY_TEMPLATES` in `packages/contracts/src/notify-io.ts` (name,
Meta category, parameter order) and the `wa.*` strings in `packages/i18n/src/locales/{ar-IQ,en}.json`
(text). This page is generated from them; if you change a text or a parameter order, change the code,
regenerate this page, and submit the template again under a **new name** (the order of `{{n}}` is part
of the contract — voice spec §6).

How to submit (WhatsApp Manager → Message templates → Create):

- One template per name below, with **two languages**: Arabic (`ar`) and English (`en`). The API sends
  `ar` unless the person chose English.
- Body only (no header, no buttons) — paste the text exactly, including Western digits and `دينار`.
  Fill the samples with the values given (Meta requires one sample per variable).
- Category as listed. Receipts and safety are UTILITY; never mark them MARKETING (they must reach
  people who did not opt in to offers).
- The OTP template is AUTHENTICATION; Meta replaces its body with its own fixed wording plus a
  copy-code button, so only the name and language matter. OTP still goes by SMS today.

Runtime (`apps/api/src/modules/notify`): `WHATSAPP_PROVIDER=meta` (or just `WHATSAPP_TOKEN` set) sends
through the Cloud API (`POST graph.facebook.com/{WHATSAPP_API_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages`,
`type: template`, body parameters as text). Statuses (sent / delivered / read / failed) come back on
`/webhooks/whatsapp` (verify token `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, signature `WHATSAPP_APP_SECRET`);
a message not delivered 60 s after sending gets its SMS twin (domain §8).

| Template | Category | Sent when | To |
|---|---|---|---|
| `order_receipt` | UTILITY | `order.delivered` (food, grocery, errands, parcels) | customer |
| `ride_receipt` | UTILITY | `order.completed` of a ride | customer |
| `wallet_topup_receipt` | UTILITY | `wallet.topped_up` (cash top-up confirmed by an agent or courier) | customer |
| `rajaa_boarding_pass` | UTILITY | `seat.booked` (الرجعة seat booked; carries the boarding code) | rider |
| `khat_child_arrived` | UTILITY | `khat.child_tapped_out` (child dropped at school / home) | guardian |
| `merchant_cash_handover` | UTILITY | `merchant.paid_by_courier` (courier handed the kitchen its cash) | merchant owners |
| `courier_cash_receipt` | UTILITY | `ops.cash_received` (field ops took a courier's cash) | courier |
| `courier_arriving` | UTILITY | (defined; no producer yet — the 2-minute arrival event) | customer |
| `driver_otp` | AUTHENTICATION | (not sent yet) | anyone |

## Templates

### `courier_arriving`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.courier_arriving` · sent by template `courier_arriving`
- Body parameters, in order: `{{1}}` name, `{{2}}` courier, `{{3}}` merchant, `{{4}}` amount

Arabic (`ar`):

```text
هلا {{1}}، الدليفري {{2}} يوصلك بعد دقيقتين بطلبك من {{3}}. المبلغ {{4}} دينار.
```

English (`en`):

```text
Hi {{1}}, courier {{2}} is 2 minutes away with your order from {{3}}. Amount {{4}} IQD.
```

Sample values for the submission: `{{1}}` = علي · `{{2}}` = حيدر · `{{3}}` = مطعم خالد · `{{4}}` = 12,500

### `order_receipt`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.order_delivered` · sent by template `order_receipt`
- Body parameters, in order: `{{1}}` merchant, `{{2}}` amount, `{{3}}` receiptUrl

Arabic (`ar`):

```text
وصل طلبك من {{1}}. المجموع {{2}} دينار. الوصل: {{3}}
```

English (`en`):

```text
Your order from {{1}} was delivered. Total {{2}} IQD. Receipt: {{3}}
```

Sample values for the submission: `{{1}}` = مطعم خالد · `{{2}}` = 12,500 · `{{3}}` = https://driver.iq/r/ord_123

### `ride_receipt`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.trip_completed` · sent by template `ride_receipt`
- Body parameters, in order: `{{1}}` amount, `{{2}}` driver, `{{3}}` receiptUrl

Arabic (`ar`):

```text
وصلت بالسلامة. الأجرة {{1}} دينار مع السايق {{2}}. الوصل: {{3}}
```

English (`en`):

```text
You arrived safely. Fare {{1}} IQD with driver {{2}}. Receipt: {{3}}
```

Sample values for the submission: `{{1}}` = 4,000 · `{{2}}` = حيدر · `{{3}}` = https://driver.iq/r/ord_123

### `merchant_cash_handover`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.merchant_cash_handover` · sent by template `merchant_cash_handover`
- Body parameters, in order: `{{1}}` store, `{{2}}` amount, `{{3}}` courier, `{{4}}` date, `{{5}}` balance, `{{6}}` reference

Arabic (`ar`):

```text
{{1}}: استلمت {{2}} دينار كاش من الدليفري {{3}} يوم {{4}}. الباقي إلك عند درايفر {{5}} دينار. الرقم المرجعي: {{6}}
```

English (`en`):

```text
{{1}}: you received {{2}} IQD cash from courier {{3}} on {{4}}. Driver still owes you {{5}} IQD. Reference: {{6}}
```

Sample values for the submission: `{{1}}` = مطعم خالد · `{{2}}` = 45,000 · `{{3}}` = حيدر · `{{4}}` = 2026-10-04 · `{{5}}` = 0 · `{{6}}` = MH-2610-0001

### `courier_cash_receipt`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.partner_settlement_receipt` · sent by template `courier_cash_receipt`
- Body parameters, in order: `{{1}}` amount, `{{2}}` date, `{{3}}` balance

Arabic (`ar`):

```text
استلمنا تسويتك {{1}} دينار بتاريخ {{2}}. رصيدك هسة {{3}} دينار.
```

English (`en`):

```text
We received your settlement of {{1}} IQD on {{2}}. Your balance is now {{3}} IQD.
```

Sample values for the submission: `{{1}}` = 60,000 · `{{2}}` = 2026-10-04 · `{{3}}` = -15,000

### `wallet_topup_receipt`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.topup_receipt` · sent by template `wallet_topup_receipt`
- Body parameters, in order: `{{1}}` amount, `{{2}}` date, `{{3}}` reference

Arabic (`ar`):

```text
انشحنت محفظتك بدرايفر بـ {{1}} دينار كاش يوم {{2}}. الرقم المرجعي: {{3}}. تگدر تدفع بيها طلباتك هسة.
```

English (`en`):

```text
Your Driver wallet was topped up with {{1}} IQD cash on {{2}}. Reference: {{3}}. You can pay for orders with it now.
```

Sample values for the submission: `{{1}}` = 25,000 · `{{2}}` = 2026-10-04 · `{{3}}` = TU-2610-0007

### `rajaa_boarding_pass`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.rajaa_boarding_pass` · sent by template `rajaa_boarding_pass`
- Body parameters, in order: `{{1}}` route, `{{2}}` date, `{{3}}` time, `{{4}}` seat, `{{5}}` vehicle, `{{6}}` place, `{{7}}` pin

Arabic (`ar`):

```text
تذكرة الرجعة: {{1}} يوم {{2}} الساعة {{3}}، مقعد {{4}}. السيارة {{5}}. نقطة التحرك: {{6}}. رمز الصعود {{7}}، گوله للسايق بس.
```

English (`en`):

```text
Return-trip ticket: {{1}} on {{2}} at {{3}}, seat {{4}}. Car {{5}}. Departure point: {{6}}. Boarding code {{7}}; tell it to the driver only.
```

Sample values for the submission: `{{1}}` = العزيزية ← بغداد · `{{2}}` = 2026-10-05 · `{{3}}` = 7:30 · `{{4}}` = A1 · `{{5}}` = كيا بونگو · 12345 واسط · `{{6}}` = كراج البوابة 1 · `{{7}}` = 4821

### `khat_child_arrived`

- Category: **UTILITY** · languages: `ar`, `en` · i18n key: `wa.khat_dropped` · sent by template `khat_child_arrived`
- Body parameters, in order: `{{1}}` child, `{{2}}` place, `{{3}}` time

Arabic (`ar`):

```text
{{1}} وصل {{2}} بالسلامة الساعة {{3}}.
```

English (`en`):

```text
{{1}} arrived at {{2}} safely at {{3}}.
```

Sample values for the submission: `{{1}}` = زينب · `{{2}}` = مدرسة الرافدين · `{{3}}` = 7:40

### `driver_otp`

- Category: **AUTHENTICATION** · languages: `ar`, `en` · i18n key: `wa.otp` · not sent yet (OTP goes by SMS)
- Body parameters, in order: `{{1}}` code

Arabic (`ar`):

```text
رمز دخولك لدرايفر: {{1}}. لا تعطيه لأحد.
```

English (`en`):

```text
Your Driver code: {{1}}. Don’t share it with anyone.
```

Sample values for the submission: `{{1}}` = 482915

