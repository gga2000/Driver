// App entry. Everything else loads when first used (metro.config.js, inlineRequires); these run at
// launch on purpose. Side-effect imports are never deferred.
// The notification handler and the new-order ring, loaded before an order can arrive.
import './src/lib/push';
import './src/lib/alert-sound';
import 'expo-router/entry';
