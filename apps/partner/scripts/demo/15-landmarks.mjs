// Landmarks on the map (maps program b3): approved landmark places around the centre, شارع 30 and
// زاكور, each with its category (mosque, school, market, clinic, fuel), so the job map and the home
// map show them from zoom 15. The seed already has the garages, the grand mosque's gate and the
// bridges. The buyer's home in زاكور now has landmarks within 500 m, so the door card says «قرب …»
// (maps a2) once the demo saves the home.
export default async function register(demo) {
  const { PlacesService, seedDemoLandmarks } = await demo.load('modules/places/index.js');
  await seedDemoLandmarks(demo.app.get(PlacesService));
}
