# الرجعة pass on the lock screen — updates while the app is closed (2026-10-06)

Customer audit d-8 follow-up (`docs/research/ui-ux-audit/customer.md`). The Android ongoing card
(`apps/customer/src/features/rajaa/lockscreen/`) is scheduled for T−30 and updated while the app runs;
now the server also tells the phone at every boarding moment, with a data-only push.

## Server
- Events (routes module, `RAJAA_PASS_EVENTS` in `@driver/contracts`): `departure.boarding`,
  `departure.driver_left_garage`, `seat.checked_in`, `departure.departed`, `departure.arrived`,
  `seat.cancelled`, `seat.moved`, `seat.no_show`, `departure.cancelled`.
- `rajaaPassPhaseFor(event, bookingState)`: boarding (still booked — the car is loading, or has left
  the garage towards his meeting point), `on_board` (checked in), `on_road` (departed with him),
  `arrived` (completed, with the fare), `gone` (cancelled / moved / no-show: the card is removed).
  Departure-wide events reach every booking on the car; seat events only their own booking.
- Notify (`passUpdatesFor` in `notify.subscribers.ts`, lookup `departurePasses`) → template
  `rajaa_pass_update` (customer app, push, `silent: true`): no title, body or sound go out — Expo gets
  `data` + `priority: high` + `_contentAvailable`; FCM gets a data message (no `notification` block).
  The delivery log still names it («تحديث تذكرة الرجعة», body = the phase).
- Payload (`RajaaPassPush`, flat strings via `encodeRajaaPassPush` / `decodeRajaaPassPush`):
  `{ kind: 'rajaa_pass_update', bookingId, phase, departAt, stop, pickupKind, toCity, seatIds, pin,
  carKm, fareIqd, sentAt }`. `carKm` is the car's last fix to his own stop (boarding only). The PIN is
  included because the card shows it on the lock screen (Ali, 2026-10-06).

## App
- `passCardFromPush` (`content.ts`) builds the same card words as the in-app `passCard`;
  `applyPassPush` (`push.ts`) re-posts it in place or removes it, dropping a push older than the last
  one applied for that booking.
- `ongoingPass.onPassPush` (Android, `expo-notifications` received listener) feeds it whenever the
  app's JS runs — in the foreground or alive in the background.

## Not yet
- **App killed:** Android delivers the data message to the app, but running JS for it needs a headless
  task — `expo-task-manager` (`TaskManager.defineTask(name, ({ data }) => applyPassPush(…))` plus
  `Notifications.registerTaskAsync(name)`). The package is not installed (dependency changes are owned
  by the Expo SDK upgrade); until then a killed app's card keeps its last words.
- **iOS Live Activity:** needs a native widget extension and an EAS build; out of scope.
