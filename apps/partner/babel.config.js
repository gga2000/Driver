module.exports = function (api) {
  api.cache(true);
  // babel-preset-expo adds the Reanimated 4 worklets plugin (react-native-worklets/plugin) itself.
  return { presets: ['babel-preset-expo'] };
};
