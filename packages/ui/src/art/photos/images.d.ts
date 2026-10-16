/**
 * Raster pictures bundled with `@driver/ui` (`photos/<group>/<name>.webp`). Metro (the apps) turns an
 * import into an asset id (number); Vite (the gallery and tests) into a URL. `<Image>` from react-native
 * and react-native-svg take either.
 */
declare module '*.webp' {
  const source: number | string;
  export default source;
}
