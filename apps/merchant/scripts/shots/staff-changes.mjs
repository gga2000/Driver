// «فريقنا عدّل بمحلك» (owner only): the board chip after our team changed two prices from the Console
// (scripts/demo/staff-changes.mjs), and the list it opens.
export default {
  name: 'staff-changes',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { byTestId, shot, signIn } = h;
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await byTestId('staff-changes-chip').waitFor({ timeout: 15_000 });
    await shot('chip');
    await byTestId('staff-changes-chip').click();
    await byTestId('staff-changes').waitFor();
    await byTestId('staff-change').first().waitFor({ timeout: 15_000 });
    await shot('list');
  },
};
