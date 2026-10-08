// CORE-04: a phone build or an over-the-air update made without the public API address would point
// every installed app at "localhost" (the fallback in each app's src/lib/api.tsx), a full outage that
// only a second update can undo. Each app's app.config.js calls assertReleaseEnv(), so:
//   - an EAS build (EAS_BUILD) or an update through scripts/deploy/eas-update.mjs (DRIVER_RELEASE=1)
//     refuses a missing address, one on this computer or a private network, one that is not https
//     or not /trpc, and the customer app refuses without EXPO_PUBLIC_SHARE_BASE_URL (on a phone,
//     share and invite links need it);
//   - any other production bundle (`expo export`) with no EXPO_PUBLIC_API_URL only warns: screenshot,
//     size and speed checks export on purpose without a real server and are never shipped.
// So a bare `eas update` is the one path left unchecked: always publish through the script.
// CommonJS on purpose: Expo loads app.config.js with require().

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)$/i;

function isRelease(env) {
  return env.EAS_BUILD === 'true' || env.EAS_BUILD === '1' || env.DRIVER_RELEASE === '1';
}

function urlProblem(name, raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return `${name} is not a web address ("${raw}")`;
  }
  if (LOCAL_HOST.test(url.hostname)) return `${name} points at a computer, not the public server ("${raw}")`;
  if (url.protocol !== 'https:') return `${name} must start with https:// ("${raw}")`;
  return null;
}

const NO_API = 'EXPO_PUBLIC_API_URL is not set: every phone would call localhost';

/** What is wrong with this app's environment for a release ([] = nothing, and always [] outside a release). */
function releaseEnvProblems(app, env) {
  if (!isRelease(env)) return [];
  const problems = [];
  const api = (env.EXPO_PUBLIC_API_URL || '').trim();
  if (!api) problems.push(NO_API);
  else {
    const p = urlProblem('EXPO_PUBLIC_API_URL', api);
    if (p) problems.push(p);
    else if (!/\/trpc\/?$/.test(new URL(api).pathname)) problems.push(`EXPO_PUBLIC_API_URL must end in /trpc ("${api}")`);
  }
  if (app === 'customer') {
    const share = (env.EXPO_PUBLIC_SHARE_BASE_URL || '').trim();
    if (!share) problems.push('EXPO_PUBLIC_SHARE_BASE_URL is not set: share and invite links would open the API');
    else {
      const p = urlProblem('EXPO_PUBLIC_SHARE_BASE_URL', share);
      if (p) problems.push(p);
    }
  }
  return problems;
}

function assertReleaseEnv(app, env = process.env, warn = console.warn) {
  if (!isRelease(env)) {
    if (env.NODE_ENV === 'production' && !(env.EXPO_PUBLIC_API_URL || '').trim()) warn(`! Driver ${app}: ${NO_API} (fine for a size or screenshot check, never ship this bundle)`);
    return;
  }
  const problems = releaseEnvProblems(app, env);
  if (!problems.length) return;
  throw new Error(
    `Driver ${app}: this release is missing its server settings (CORE-04):\n` +
      problems.map((p) => `  - ${p}`).join('\n') +
      '\nSet them in the EAS environment (expo.dev → project → Environment variables) and publish with ' +
      '`node scripts/deploy/eas-update.mjs`; see docs/deploy/mobile.md.',
  );
}

module.exports = { releaseEnvProblems, assertReleaseEnv, isRelease };
