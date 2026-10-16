// CORE-05 shots: «حدّث التطبيق», the one screen an old build gets once the server refuses it. The demo
// API refuses merchant builds below 0.0.2 (scripts/demo-api.mjs); a dev-tools web export opened with
// `?demoBuild=0.0.1` reports that build, so the first call answers `update_required`.
export default {
  name: 'app-version',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, origin, byTestId, shot, signIn } = h;
    await signIn('0770 123 4567');
    // A full load: the build header is read once when the app starts.
    await page.goto(`${origin}/?demoBuild=0.0.1`, { waitUntil: 'load' });
    await byTestId('update-required').waitFor({ timeout: 20_000 });
    await shot('update-required', { wait: 900 });
  },
};
