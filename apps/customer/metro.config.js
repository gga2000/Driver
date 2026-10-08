// Monorepo-aware Metro config for pnpm: watch workspace packages, resolve through the pnpm
// virtual store, and pin the React singletons to this app's copies.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

// Keep Expo's own monorepo defaults (expo-doctor checks them) and add the workspace root.
config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];
// Never crawl or watch build output, logs or nested agent worktrees (full repo copies under this
// checkout's .claude/): on a big checkout they multiply Metro's file map and memory. Anchored at this
// workspace root, so a checkout that itself lives inside some .claude/worktrees/… still builds.
// (Not `dist`: workspace packages and dependencies ship their code there.)
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sep = '[/\\\\]';
const ROOT_ONLY = ['.claude', '.studio', '.turbo'].map((d) => escape(path.join(workspaceRoot, d)) + `(${sep}|$)`);
const ANYWHERE = ['.next', 'dist-web', 'dist-e2e', 'coverage', 'web-shots', 'gallery-dist', 'gallery-shots'].map((d) => `${sep}${escape(d)}(${sep}|$)`);
const ignored = new RegExp(`^(${ROOT_ONLY.join('|')})|${ANYWHERE.join('|')}`);
const blockList = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(blockList) ? blockList : blockList ? [blockList] : []), ignored];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules'), path.resolve(workspaceRoot, 'node_modules')];
// pnpm: packages resolve their own deps through the virtual store (node_modules/.pnpm/node_modules),
// so hierarchical lookup must stay on (Babel-injected @babel/runtime helpers need it).
config.resolver.disableHierarchicalLookup = false;
// superjson's deps (copy-anything, is-what) ship `exports` only, no `main`.
config.resolver.unstable_enablePackageExports = true;

// The console app uses React 19, and pnpm's hoisted store can hand that copy to a dependency of
// ours. Two Reacts in one bundle = "Objects are not valid as a React child". Every import of these
// packages (and their subpaths, e.g. react/jsx-runtime) resolves from this app instead.
const SINGLETONS = ['react', 'react-dom', 'react-native', 'react-native-web', 'react-native-reanimated', 'react-native-worklets', 'react-native-safe-area-context', 'react-native-svg', 'react-native-gesture-handler', 'react-native-screens', '@tanstack/react-query'];
// Speed s1: a production build leaves out the other apps' strings (scripts/locale-subset.cjs), about
// two thirds of the shared tables. Dev keeps the full tables so a newly added key shows at once.
let localeSubset = null;
const subsetLocales = () =>
  (localeSubset ??= require('./scripts/locale-subset.cjs').writeCustomerLocales({ repoRoot: workspaceRoot, outDir: path.join(projectRoot, 'node_modules/.cache/customer-locale') }));
const LOCALE_FILE = /^\.\/locales\/(ar-IQ|en)\.json$/;

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const locale = process.env.NODE_ENV === 'production' ? LOCALE_FILE.exec(moduleName) : null;
  if (locale && /[\\/]i18n[\\/]/.test(context.originModulePath)) return { type: 'sourceFile', filePath: subsetLocales()[locale[1]] };
  const pkg = SINGLETONS.find((p) => moduleName === p || moduleName.startsWith(`${p}/`));
  if (pkg) {
    const origin = path.join(projectRoot, 'package.json');
    return (upstream ?? context.resolveRequest)({ ...context, originModulePath: origin }, moduleName, platform);
  }
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
