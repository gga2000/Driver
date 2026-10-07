# «احجي ويا الدعم» — the support chat inside an order (2026-10-07)

Closes the before-launch gap "no support chat inside an order" (`docs/before-launch.md` §6). The
customer writes to our support desk about one order from the order screen; the desk answers from the
Console case with the order's context. It is one more thread kind of the order chat
(`packages/contracts/src/chat-io.ts`), so it reuses the chat's storage, masking, photos, read receipts,
live stream and push.

## The thread (`chat.*`, kind `customer_support`)

| Rule | Value |
|---|---|
| Parties | the orderer (`customer`) and the desk (`support`: support, dispatcher, admin). A rider or a group-order guest on the order is **not** in it (`chat_not_party`); nor are the courier or the kitchen |
| Orders | every order kind (food, grocery, parcel, ride) |
| Opens | at placement (status `open` straight away, no accept needed) |
| Closes | for the customer `CHAT_SUPPORT_CLOSE_AFTER_H` = 24 h after the order is done (delivered, cancelled…); the desk can still answer after that |
| Send limit | the chat's own: 20 messages a minute per person (`CHAT_RULES.sendsPerMinute`) |
| Opening limit | a customer starts at most `CHAT_SUPPORT_OPENS_PER_DAY` = 5 new support chats (one per order) in 24 h; the 6th is `chat_support_limit` (429, «فتحت محادثات وايد اليوم…»). An open chat keeps working |
| Calls | none (`chat.requestCall` → `chat_not_party`, `canCall: false`; calls are in before-launch §3) |
| Quick replies | `customer_support_late`, `customer_support_wrong` (deliveries), `customer_support_courier` / `customer_support_driver` (rides), `customer_support_money` |
| Location | not offered in this thread (the desk needs words and photos) |

`chat.threads` lists it for the orderer on every order; `chat.thread`, `chat.send`, `chat.markRead`
and `live.chat({ orderId, kind: 'customer_support' })` work as for the other kinds. Read receipts: the
customer side and the desk are one reader each (`readerKey` `customer` / `support`), so «شافها» under
his message means any agent read it.

## The case (`support.*`)

- The customer's **first** message opens one ticket per order: kind `question`, channel `chat`,
  subject «محادثة من الطلب: <first words>», `sourceKey` `support_chat:<orderId>`, the order and its
  trip attached, the normal same-day SLA. Later messages update `lastActivityAt`; a message on a
  `waiting` case puts it back to `open`; on a `resolved` case it **reopens** it (a `reopen` line «الزبون
  كتب من جديد: …», fresh SLA, `reopenCount + 1`).
- `support.get` returns `supportChat` (the thread as the desk sees it; the desk is "mine") whenever
  the customer wrote in the order's support chat — on the chat case and on any other case about the
  same order (there the Console shows it as a read-only tab).
- `support.reply` on a `chat` case (not internal) sends the text into the chat (≤ 500 characters,
  `CHAT_TEXT_MAX`) instead of the push/WhatsApp answer; the entry keeps `meta.chatMessageId`. The first
  answer sets `firstResponseAt`, assigns the case to the agent and moves it to `waiting`. Internal
  notes never reach the chat.
- `support.chatRead({ ticketId, seq })` → `{ ok: true }`: the desk read the chat up to `seq`.
- `support.open` never takes channel `chat` (those cases only open from the customer's message).

The roles are the desk's (`SUPPORT_DESK_ROLES`, finance included): finance answers through the case
even though it isn't a chat party itself.

## Apps
- Customer (`apps/customer/app/order/[id].tsx`): the «احجي ويا الدعم» row in the order's actions
  (unread count from the desk in its hint), and the same button in «عندي مشكلة» before the
  order reaches him. The thread is the shared `ChatThread` titled «فريق الدعم», with its own empty state.
  Pushes: «رسالة جديدة من الدعم» (`push.chat_message.title_support`), deep link to the thread.
- Console (`apps/console/src/components/support/chat-case.tsx`): a chat case reads as one
  conversation — the customer's messages and our answers, interleaved with the desk's own lines
  (notes, refunds, fault, escalation); live over `live.chat`, with the 10-second case poll as the
  fallback; the composer says «ردّك يوصل للزبون بمحادثة الطلب».

## Demo
- Customer demo API: `POST /demo/chat?personId=…&scenario=support` (an order on the way, he asked
  about the delay, زينب answered) and `scenario=support_empty`; `SHOTS=chat` writes `chat-support-*.png`.
- Console demo API seeds one chat case on an order (`/demo/seed` → `people.supportChat.desk`);
  `scripts/shots.mjs` writes `07b-support-chat-case.png`.

## Tests
`apps/api/src/modules/support/support-chat.test.ts` (parties, every order kind, the case, replies into
the chat, reopen, closing, the opening limit), `apps/api/src/modules/chat/chat.service.test.ts`,
`apps/console/src/lib/support-chat.test.ts`, `packages/ui/src/components/shared.test.tsx`.
