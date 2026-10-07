# Staff way-outs, complaint outcomes and cash limits (W3)

Server side of W3 (`/mnt/project-files/audit/plan.md` §W3, §3.2, §3.3). The Console screens are
built by another lane; this file is what they call.

Every staff mutation takes a written `reason` (3–500 characters), checks the staff role, and writes
exactly one `console_audit_log` row **in the same transaction** as the change. A replay (the order
or departure is already where the action leads) changes nothing, writes no row and returns
`changed: false, auditId: null`.

**Money rule:** nothing here changes an existing amount or who gets paid. Every money outcome that
Ali has not decided is behind its own switch, **off by default**. While a switch is off, the
procedure that needs it refuses with `money_rule_off`. Shown in Arabic as «هذا الشي ينتظر قرار
الإدارة، ما مشتغل بعد».

## Procedures

### Orders: `orders.*`

| Path | Kind | Roles | Input | Output |
|---|---|---|---|---|
| `orders.cashStanding` | query | any signed-in | none | `CashStanding` |
| `orders.ops.stuck` | query | dispatcher, support, finance, admin | `StuckOrdersInput` | `StuckOrder[]` |
| `orders.ops.cancel` | mutation | dispatcher, support, admin | `StaffCancelOrderInput` | `StaffActionResult` |
| `orders.ops.markDelivered` | mutation | dispatcher, support, admin | `StaffMarkDeliveredInput` | `StaffActionResult` |
| `orders.ops.close` | mutation | dispatcher, support, admin | `StaffCloseOrderInput` | `StaffActionResult` |
| `orders.ops.courierLost` | mutation | dispatcher, support, admin | `StaffCourierLostInput` | `StaffActionResult` |
| `orders.ops.chargeCourier` | mutation | dispatcher, finance, admin | `StaffChargeCourierInput` | `StaffActionResult` |
| `orders.ops.resolveDispute` | mutation | support, dispatcher, finance, admin | `ResolveDisputeInput` | `StaffActionResult` |

The input shapes (`packages/contracts/src/order-staff-io.ts`) are below. `Reason` is
`z.string().trim().min(3).max(500)`.

```ts
StaffCancelOrderInput   { orderId: string(min 1), reason: Reason, onBehalfOfCustomer: boolean = false }
StaffMarkDeliveredInput { orderId, reason, cashCollectedIqd?: int ≥ 0 }   // default: the order total
StaffCloseOrderInput    { orderId, reason }
StaffCourierLostInput   { orderId, reason }
StaffChargeCourierInput { orderId, reason }
ResolveDisputeInput     { orderId, outcome: 'stands'|'refund_full'|'refund_partial'|'redelivery'|'void',
                          reason, amountIqd?: int > 0 (required for refund_partial and only then),
                          faultParty: 'none'|'courier'|'merchant'|'platform'|'customer' = 'platform' }
StuckOrdersInput        { cityId: string(min 1), limit: int 1..500 = 200 }

StaffActionResult { orderId, state: OrderState, changed: boolean, postedIqd: int, auditId: string | null }
StuckOrder        { orderId, ticket, type, state, reason: StuckReason, since, minutes, platformFailure,
                    totalIqd, paymentMethod, actions: ('cancel'|'markDelivered'|'close'|'courierLost'|'resolveDispute')[] }
CashStanding      { owedIqd, unpaidFees, openCashOrders, openCashLimit: int | null, cashAllowed,
                    blockedBy: 'open_cash_orders_cap'|'cash_debt_blocked'|'prepay_required'|null }
```

What each procedure does:

- **`cancel`**: works on any live order. The order moves to `platform_cancelled` and is always free
  for the customer. A wallet order's hold is released. A courier trip is detached; a ride's trip is
  cancelled. With `onBehalfOfCustomer`, the order is cancelled as the customer's own cancel instead,
  so the normal fee rules apply. If food was already being prepared, the kitchen is paid by the
  platform only when M-2 is on with `cookedFoodPayer = platform`. Emits `order.ops_cancelled` (push
  `order_ops_cancelled`).
- **`markDelivered`**: from `picked_up` only. Takes the courier's normal delivery path, with cash
  collected (by default, the order total).
- **`close`**: from `delivered` or `completed`. Settles at once, without waiting the 2 h. It refuses
  a disputed order; use `resolveDispute` for that.
- **`courierLost`**: from `picked_up`. Opens a `courier_lost` dispute and never re-dispatches. With
  `COURIER_LOST_REFUND` on, it also ends at once: the order is `refunded` with nothing charged, and
  the platform pays the kitchen (ledger group `order:<id>:courier_lost:kitchen`). Emits
  `order.courier_lost`.
- **`chargeCourier`**: needs `COURIER_LOST_CHARGE`. Posts one `adjustment` of the food cost,
  `cash:<courier>` → `platform` (group `order:<id>:courier_lost:charge`).
- **`resolveDispute`**: needs the chosen outcome in `DISPUTE_OUTCOMES`. It acts once per order; a
  second call returns `changed: false`. Refunds above `agentLimitIqd` (25,000) need an admin
  (`refund_needs_escalation`). A refund is never more than what was paid, less earlier refunds. The
  party at fault pays: courier `driver:<id>`, merchant `merchant_cash:<org>`, otherwise `platform`.
  - `stands` closes normally.
  - `refund_full` and `refund_partial` close the order, then post `dispute:<id>:refund` to the
    customer's wallet. A full refund ends the order in `refunded`.
  - `redelivery` closes the order and flags it. A resend order is **not** created automatically.
  - `void` works only if the order was never delivered.

  Emits `order.dispute_resolved` (push `order_dispute_refunded` / `_stands` / `_redelivery` /
  `_void`).
- **`stuck`**: lists orders that need a person, oldest first.
  - Reasons: `merchant_no_answer`, `kitchen_silent`, `no_courier`, `courier_lost`, `not_closed`,
    `dispute_open`, `dispute_overdue`, `ride_no_driver`, `ride_driver_no_show`, `ride_not_closed`.
  - Each row comes with the actions that apply to it.

### الرجعة departures: `routes.ops.*`

| Path | Kind | Roles | Input | Output |
|---|---|---|---|---|
| `routes.ops.overdueDepartures` | query | dispatcher, support, admin | `OverdueDeparturesInput` | `OverdueDeparture[]` |
| `routes.ops.cancelDeparture` | mutation | dispatcher, support, admin | `StaffDepartureInput` | `StaffDepartureResult` |
| `routes.ops.arriveDeparture` | mutation | dispatcher, support, admin | `StaffDepartureInput` | `StaffDepartureResult` |
| `routes.ops.closeDeparture` | mutation | dispatcher, support, admin | `StaffDepartureInput` | `StaffDepartureResult` |

The input shapes are in `packages/contracts/src/departure-staff-io.ts`:

```ts
StaffDepartureInput    { departureId: string(min 1), reason: Reason }
OverdueDeparturesInput { limit: int 1..200 = 100 }
StaffDepartureResult   { departureId, state: IntercityDepartureState, changed, auditId: string | null }
OverdueDeparture       { departureId, corridorId, garageId, driverId, state, reason: 'driver_no_show'|'not_arrived',
                         since, minutes, riders, actions: ('cancel'|'arrive')[] }
```

- **`cancelDeparture`**: from `scheduled` or `boarding`. Riders move to the next cars exactly as on a
  driver cancel (held seats are let go; anyone with no car within 2 h is stranded onto the request
  board). There is **no fee for the driver and no credit for riders**, because M-11 is open.
  - `departure.cancelled` carries `cancelledBy: 'driver', feeIqd: 0`.
  - `departure.ops_cancelled` carries `{ reason, auto, riders }`.
  - Seats only settle when the car arrives, so nobody was charged.
- **`arriveDeparture`**: from `departed`. It does the same as the driver's own «وصلت»: checked-in
  seats complete and `seat.completed` settles each seat.
- **`closeDeparture`**: from `arrived`. Closes it now; the scheduler would otherwise close it after
  `closeAfterArrivalMin`.
- **`overdueDepartures`**: lists departures in one of two cases:
  - `driver_no_show`: still `scheduled` or `boarding`, 20 min past the latest departure time.
  - `not_arrived`: `departed`, 30 min past the corridor's travel time.

## Switches (all off by default)

| Rule | Env | Default | What it turns on |
|---|---|---|---|
| M-1 complaint outcomes (NTF-01) | `DISPUTE_OUTCOMES` (comma list or `all`) | none | which `resolveDispute` outcomes staff may use |
| M-1 complaint watchdog | `DISPUTE_AUTO_OUTCOME` | off | escalate after 48 h (audit row and `order.dispute_escalated`); after 72 h the complaint stands |
| M-2 free cancel when we failed (NTF-11) | `PLATFORM_FAILURE_FREE_CANCEL` | off | no fee when there is no courier, the kitchen is silent or the ride driver did not show; `order.free_cancel_offered` once |
| M-2 who pays cooked food | `PLATFORM_FAILURE_FOOD_PAYER` (`platform`\|`merchant`) | `platform` | with `platform`, a free cancel of a cooked order pays the kitchen (`order:<id>:platform_failure`) |
| M-3 cash debt block (THIN-01) | `CASH_DEBT_BLOCK` | off | 2 unpaid fees or more than 5,000 owed stops cash orders (`cash_debt_blocked`) |
| M-4 open cash cap (SEC-10) | `OPEN_CASH_CAP` | off | 1 open cash order below 3 completed orders, 2 after (`open_cash_orders_cap`) |
| M-4 prepay after «ما جاوب» | `PREPAY_AFTER_NO_ANSWER` | off | the next order after a no-answer at the door must be paid from the wallet (`prepay_required`) |
| M-10 courier lost (NTF-13) | `COURIER_LOST_REFUND` | off | ends a lost order at once, refunded, with the kitchen paid |
| M-10 charge the courier | `COURIER_LOST_CHARGE` | off | `chargeCourier` |
| M-11 garage no-show (NTF-14) | `GARAGE_NO_SHOW_AUTO_CANCEL` | off | the watch cancels a no-show departure on its own, as `system`, with an audit row |
| M-13 agent cash accounts (THIN-12) | `AGENT_CASH_ACCOUNTS` | off | an agent's top-up cash sits on `cash:<agent>` instead of `bank` |

`cashStanding` always reports what is owed and how many cash orders are open, even while the block
and the cap are off.

## Audit actions

`console_audit_log.action` values, with `subject_kind`:

- `order`: `order.ops_cancel`, `order.ops_mark_delivered`, `order.ops_close`,
  `order.ops_courier_lost`, `order.ops_charge_courier`, `order.ops_resolve_dispute`,
  `order.dispute_escalated` (by `system`).
- `departure`: `departure.ops_cancel` (`system` when automatic), `departure.ops_arrive`,
  `departure.ops_close`.

## Other server changes in W3

- **FLOW-20.** A rating no longer closes the order. The 2-h complaint window stays open and the
  auto-close settles it.
- **FLOW-24.** Top-up agent shops come only from `TOPUP_AGENTS_JSON`. With none set, the agent
  channel shows «قريباً» and no shop is listed.
- **THIN-11.** The cash top-up channel names the courier bringing the order («الدليفري اللي جايب
  طلبك»).
