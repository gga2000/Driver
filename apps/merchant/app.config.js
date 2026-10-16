// app.json is the app's config; this only refuses a bundle or release made without the server address
// (CORE-04, scripts/deploy/release-env.cjs).
const { assertReleaseEnv } = require('../../scripts/deploy/release-env.cjs');

module.exports = ({ config }) => {
  assertReleaseEnv('merchant');
  return config;
};
