/* eslint-disable */
/**
 * Webpack loader, production builds only (next.config.ts): gives each Console source file its own Arabic
 * words (scripts/locale-subset.mjs, `withOwnWords`), so a page loads only the words of the screens it shows.
 */
const fs = require('node:fs');

let cached = null;
module.exports = async function wordsLoader(source) {
  const { wordsPath, arPath } = this.getOptions();
  cached ??= {
    words: JSON.parse(fs.readFileSync(wordsPath, 'utf8')),
    shared: JSON.parse(fs.readFileSync(arPath, 'utf8')),
    withOwnWords: (await import('./locale-subset.mjs')).withOwnWords,
  };
  return cached.withOwnWords(source, { words: cached.words, shared: cached.shared, tablePath: arPath });
};
