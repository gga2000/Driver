// App entry. Everything else loads when first used (metro.config.js, inlineRequires); these run at
// launch on purpose. Side-effect imports are never deferred.
// The background location task must be defined at launch: Android and iOS start the app without
// any screen to deliver positions while the courier is online.
import './src/lib/background-location';
// The notification handler and the offer ring, loaded before an offer can arrive (a ring that loads
// on the first offer starts late).
import './src/lib/push';
import './src/lib/alert';
import 'expo-router/entry';
