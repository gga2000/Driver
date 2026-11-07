# Stuck orders

Decided by Ali on 2026-11-07 ("go" on the stuck-orders review). Before this, food the courier had
picked up only ended when the courier pressed «وصل» or staff acted in the Console, so a test order
on staging stayed «طلبك بالطريق» for days.

## Rules

| When | What happens | Money |
| --- | --- | --- |
| Food on the way 90 min after pickup | Push `order_arrival_check` «وصلك الطلب؟», once per order | — |
| Customer answers «إي» (`orders.confirmArrival`, `arrived: true`) | Delivered, as the courier's «وصل» (`markDelivered`) | Normal sale; a cash order's cash counts as the courier's |
| Customer answers «لا» (`arrived: false`) | «ما وصل» (`courierLost`) at once | Customer pays nothing; Driver pays the kitchen the food (M-10) |
| Still on the way 3 h after pickup, no answer | «ما وصل» by itself | Same as above |
| Any order still open 24 h after it was placed (or its booked time) | Before pickup: cancelled free (`platform_cancelled`). On the way: «ما وصل». Delivered: closed, but only once its 2-h complaint window is over | Free for the customer; cooked food paid to the kitchen by Driver (M-2) |
| Kitchen silent 10 min past its ready time, or ready food with no courier 15 min | Free cancel offered (`order.free_cancel_offered`, push `order_free_cancel`) | M-2: Driver pays the cooked food |

Complaints (`disputed`) are never ended by the watchdog: they stay with support. Charging a courier
for lost food stays a staff decision (`COURIER_LOST_CHARGE`, off).

`orders.confirmArrival` is refused with `order_state_conflict` before the question was asked, and with
`forbidden` on someone else's order. A replay, or an order the courier already finished, returns the
order unchanged.

## Where it runs

`OrdersStaffService.endStuck`, inside the W3 watchdog (`OrdersStaffJob`, every 5 minutes, job machines
only). Every step is once per order (the order's state or its event log), so a second machine or a
restart repeats nothing. Automatic actions are audited with actor `system`; the customer's answer is
audited with the customer as actor.

## Switches (environment)

| Variable | Default | Off |
| --- | --- | --- |
| `STUCK_ORDER_AUTO_END` | on | `off` stops the question, the 3-h end and the 24-h end |
| `PLATFORM_FAILURE_FREE_CANCEL` | on (was off before 2026-11-07) | `off` |
| `COURIER_LOST_REFUND` | on (was off before 2026-11-07) | `off` |

The numbers (90 min, 3 h, 24 h) are in `DEFAULT_ORDER_OUTCOME_RULES.stuckOrders`.
