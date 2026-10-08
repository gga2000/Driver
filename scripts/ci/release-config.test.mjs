// node --test scripts/ci/release-config.test.mjs (also run by `pnpm test`). CORE-04: no phone build or
// over-the-air update can ship pointing at localhost.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import { updateArgs } from '../deploy/eas-update.mjs';

const require = createRequire(import.meta.url);
const { releaseEnvProblems, assertReleaseEnv } = require('../deploy/release-env.cjs');

const API = 'https://driver-api.fly.dev/trpc';
const SHARE = 'https://driver.iq';
const APPS = ['customer', 'partner', 'merchant'];

test('the studio and local work are never stopped', () => {
  assert.deepEqual(releaseEnvProblems('customer', {}), []);
  assert.deepEqual(releaseEnvProblems('customer', { NODE_ENV: 'development' }), []);
});

test('a production bundle without the API address is refused; a local one for screenshots is allowed', () => {
  assert.match(releaseEnvProblems('partner', { NODE_ENV: 'production' })[0], /EXPO_PUBLIC_API_URL is not set/);
  assert.deepEqual(releaseEnvProblems('customer', { NODE_ENV: 'production', EXPO_PUBLIC_API_URL: 'http://127.0.0.1:3200/trpc' }), []);
});

test('an EAS build or update refuses localhost, a private address, plain http and a path without /trpc', () => {
  for (const flag of [{ EAS_BUILD: 'true' }, { DRIVER_RELEASE: '1' }]) {
    const env = (url) => ({ ...flag, EXPO_PUBLIC_API_URL: url });
    assert.deepEqual(releaseEnvProblems('merchant', env(API)), []);
    assert.match(releaseEnvProblems('merchant', env('http://localhost:3000/trpc'))[0], /points at a computer/);
    assert.match(releaseEnvProblems('merchant', env('https://192.168.1.4/trpc'))[0], /points at a computer/);
    assert.match(releaseEnvProblems('merchant', env('http://driver-api.fly.dev/trpc'))[0], /https/);
    assert.match(releaseEnvProblems('merchant', env('https://driver-api.fly.dev'))[0], /\/trpc/);
    assert.match(releaseEnvProblems('merchant', env('driver-api'))[0], /not a web address/);
    assert.match(releaseEnvProblems('merchant', flag)[0], /not set/);
  }
});

test('a customer release also needs the share link address', () => {
  const env = { EAS_BUILD: 'true', EXPO_PUBLIC_API_URL: API };
  assert.match(releaseEnvProblems('customer', env)[0], /EXPO_PUBLIC_SHARE_BASE_URL is not set/);
  assert.match(releaseEnvProblems('customer', { ...env, EXPO_PUBLIC_SHARE_BASE_URL: 'http://localhost:8081' })[0], /points at a computer/);
  assert.deepEqual(releaseEnvProblems('customer', { ...env, EXPO_PUBLIC_SHARE_BASE_URL: SHARE }), []);
  assert.deepEqual(releaseEnvProblems('partner', env), []);
});

test('assertReleaseEnv throws with every problem listed, and passes a good release', () => {
  assert.throws(() => assertReleaseEnv('customer', { DRIVER_RELEASE: '1' }), /CORE-04[\s\S]*API_URL[\s\S]*SHARE_BASE_URL/);
  assert.doesNotThrow(() => assertReleaseEnv('customer', { DRIVER_RELEASE: '1', EXPO_PUBLIC_API_URL: API, EXPO_PUBLIC_SHARE_BASE_URL: SHARE }));
});

test('every app config runs the check, and app.json carries no stale server address', async () => {
  for (const app of APPS) {
    const configPath = new URL(`../../apps/${app}/app.config.js`, import.meta.url);
    assert.ok(existsSync(configPath), `apps/${app}/app.config.js`);
    const config = require(configPath.pathname);
    const base = { name: app };
    const saved = { ...process.env };
    try {
      delete process.env.EAS_BUILD;
      delete process.env.EXPO_PUBLIC_API_URL;
      process.env.DRIVER_RELEASE = '1';
      assert.throws(() => config({ config: base }), /CORE-04/, `apps/${app}/app.config.js must refuse a release with no address`);
      process.env.EXPO_PUBLIC_API_URL = API;
      process.env.EXPO_PUBLIC_SHARE_BASE_URL = SHARE;
      assert.equal(config({ config: base }), base);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
    const json = JSON.parse(readFileSync(new URL(`../../apps/${app}/app.json`, import.meta.url), 'utf8'));
    assert.equal(json.expo.extra?.apiUrl, undefined, `apps/${app}/app.json extra.apiUrl is unused and misleading`);
  }
});

test('every EAS build profile names its environment, the same as its channel', () => {
  for (const app of APPS) {
    const eas = JSON.parse(readFileSync(new URL(`../../apps/${app}/eas.json`, import.meta.url), 'utf8'));
    for (const [name, profile] of Object.entries(eas.build)) {
      if (!profile.channel) continue; // `base` only holds shared tool versions
      assert.ok(profile.environment, `apps/${app}/eas.json build.${name} has no environment`);
      assert.equal(profile.environment, profile.channel, `apps/${app}/eas.json build.${name}`);
    }
  }
});

test('the update script ties the environment to the channel and checks its inputs', () => {
  assert.deepEqual(updateArgs('customer', 'production', ' Fix checkout text '), ['update', '--channel', 'production', '--environment', 'production', '--message', 'Fix checkout text', '--non-interactive']);
  assert.throws(() => updateArgs('console', 'production', 'x'), /app must be/);
  assert.throws(() => updateArgs('customer', 'staging', 'x'), /channel must be/);
  assert.throws(() => updateArgs('customer', 'preview', ''), /say what changed/);
});
