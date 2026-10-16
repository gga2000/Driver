// App entry. Everything else loads when first used (metro.config.js, inlineRequires); these run at
// launch on purpose. Side-effect imports are never deferred.
// The notification handler (foreground alerts, moment sounds) is set before any notification can arrive.
import './src/lib/push';
import 'expo-router/entry';
