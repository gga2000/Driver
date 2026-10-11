# `khat.guardian.run`: the guardian's bus map (map idea N14)

Ali, 2026-10-11: «بس بيتك والباص». A guardian sees today's run of one of his own children: his
child's home, the school and the bus. Other children's stops are dots with no position.

- **Who:** any signed-in person, his own children only. Anyone else gets `forbidden`.
- **Input:** `{ childRef }`. **Output:** `GuardianRunView`, or null when the child has no run today.
- **School and home:** the school is the end of the child's ride that more of the run's stops share
  (within 60 m): the drop-offs in the morning (`leg: 'to_school'`), the pick-ups in the afternoon
  (`leg: 'to_home'`). The other end is home.
- **The bus:** its last position is sent only while the run's next stop is this child's or the
  school's. While it heads to another child's stop, `bus` is null and `busAway` is true, because the
  bus's position would otherwise show that home. It also stays hidden until it is 300 m
  (`GUARDIAN_BUS_PRIVACY_M`) from every other child's stop, and a stop the bus is still within 300 m
  of counts as not done. So neither the first fix nor the moment a neighbour's stop settles points at
  that home. Once the child is delivered or absent, the bus is not sent.
- **Other children:** `others` holds one `{ done }` per stop in run order, with no position, name or
  zone. `stopsBefore` counts the ones still to come before this child's next stop.
- **Road:** `polyline6` runs only through the public points (the bus when it is shown, the home and
  the school). `minutes` is the shown bus's time to the child's next point. Without a road router
  `polyline6` is null and the app draws straight lines.
