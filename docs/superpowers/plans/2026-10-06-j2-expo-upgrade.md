# J2 — Expo SDK upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the three Expo apps (customer, partner, merchant) from Expo SDK 52 to the current stable
SDK (`npm view expo dist-tags` → `latest` = **57.0.26** on 2026-10-06), one major at a time, replacing
`expo-av` with `expo-audio`, with no visual regressions on the web builds.

**Architecture:** Each SDK step is one commit: `npx expo install expo@^<N>.0.0` then
`npx expo install --fix` in each app (the apps always move together), shared package peer/dev ranges
(`packages/ui`) follow the apps' React / React Native, code fixes for that SDK's breaking changes, then
the gate (typecheck, lint, test, web export). `expo-av` → `expo-audio` happens in the first step
(SDK 53, where expo-audio is the replacement; expo-av gets no SDK 54+ releases and is removed in 55).
Spec: `docs/specs/2026-10-05-customer-joy.md` §5.2. Upgrade notes: expo.dev/changelog/sdk-53 … sdk-57.

**Tech Stack:** pnpm workspaces, Expo SDK, React Native, expo-router, Reanimated, react-native-web,
Vitest, Playwright (web screenshots).

---

## What each SDK step brings (from the official notes)

| SDK | React / RN | What touches us |
| --- | --- | --- |
| 53 | 19.0 / 0.79 | React 19 types (`@types/react` 19, `useRef` needs an argument, `JSX` namespace); Metro `package.json#exports` on by default (we already opt in); expo-av deprecated → **expo-audio**; expo-notifications handler `shouldShowAlert` deprecated → `shouldShowBanner` + `shouldShowList`; expo-router 5; edge-to-edge default for new projects; TS ~5.8 |
| 54 | 19.1 / 0.81 | **Reanimated 4** (+ `react-native-worklets`; babel plugin comes from babel-preset-expo — the explicit `react-native-reanimated/plugin` line must go or become `react-native-worklets/plugin`); edge-to-edge always on (Android 16); expo-notifications deprecated exports removed; RN `SafeAreaView` deprecated (we already use react-native-safe-area-context); expo-router 6; Node ≥ 20.19.4 |
| 55 | 19.2 / 0.83 | Legacy architecture gone, `newArchEnabled` removed from app.json; expo-av removed; `notification` app.json field removed (we use the plugin) |
| 56 | 19.2 / 0.85 | expo-router no longer depends on react-navigation (we import none of `@react-navigation/*`); TS 6; `expo/fetch` is the global fetch (SSE/tRPC check); iOS minimum 16.4; `@expo/vector-icons` deprecated (not used) |
| 57 | 19.2 / 0.86 | No breaking changes announced; `expo prebuild` cleans native dirs by default |

## Files

- Modify: `apps/{customer,partner,merchant}/package.json`, `pnpm-lock.yaml` — via `expo install` only.
- Modify: `apps/*/babel.config.js` (SDK 54: reanimated plugin), `apps/*/app.json` (SDK 55: drop `newArchEnabled`).
- Modify: `packages/ui/package.json` — peer and dev ranges equal to the apps' versions.
- Modify (expo-audio): `apps/customer/src/lib/sound.ts`, `apps/customer/src/lib/moment-sound.ts` (comments,
  `MomentBehavior`), `apps/customer/src/lib/moment-channel.ts` (comment),
  `apps/partner/src/lib/alert.native.ts`, `apps/merchant/src/lib/alert-sound.native.ts` (+ courier chime),
  `apps/merchant/src/lib/alert-sound.ts` (comment), READMEs that name expo-av.
- Modify (notifications): `apps/*/src/lib/push.native.ts` handler result.
- Modify (docs): `CLAUDE.md` ("the apps are Expo SDK 52"), `docs/deploy/mobile.md` (SDK line, dev builds).

## Task 0: Baseline

- [ ] `pnpm install && pnpm build` in the worktree.
- [ ] Before shots: for each app, `EXPO_OFFLINE=1 CI=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:<port>/trpc
      EXPO_PUBLIC_DEV_TOOLS=1 npx expo export --platform web --output-dir <dist>`, start
      `PORT=<port> node scripts/demo-api.mjs`, run `node scripts/web-shots.mjs <out>` (ports 3410–3412,
      never 3200/3301/3302/8081–8083/3100/4000). Customer: `SHOTS=app,acct,food,track,rajaa,deals,chat,ride`
      (topup needs a second partner export).
- [ ] If `expo export` hangs: look for an injected `build-hook-start` line near the top of
      `node_modules/.pnpm/@expo+cli@*/node_modules/@expo/cli/build/src/start/index.js` (local editor
      extension), strip it, never commit anything about it.

## Task 1: SDK 53 + expo-audio

- [ ] In each app: `npx expo install expo@^53.0.0 && npx expo install --fix`; add `expo-audio` with
      `npx expo install expo-audio`; `pnpm remove expo-av`.
- [ ] `packages/ui/package.json`: peer and dev versions of react, react-dom, react-native,
      react-native-web, reanimated, gesture-handler, safe-area-context, svg, netinfo, `@types/react(-dom)` =
      the apps' new versions.
- [ ] expo-audio port. Mapping (expo-av → expo-audio):
      `Audio.setAudioModeAsync({ playsInSilentModeIOS, interruptionModeIOS, interruptionModeAndroid,
      shouldDuckAndroid, staysActiveInBackground, playThroughEarpieceAndroid })` →
      `setAudioModeAsync({ playsInSilentMode, interruptionMode, shouldPlayInBackground,
      shouldRouteThroughEarpiece })`;
      `Audio.Sound.createAsync(src, { volume, isLooping })` → `createAudioPlayer(src)` then
      `player.volume = …; player.loop = …`; `replayAsync()` → `seekTo(0)` then `play()`;
      `stopAsync()` → `pause()` then `seekTo(0)`.
      Behaviour to keep: customer cues respect the iPhone silent switch and duck others, Android cues
      still go through the ring stream (`moment-channel.native.ts`, untouched); partner offer loop and
      merchant alarms play in silent mode, do not mix, Android media stream; merchant courier chime at
      0.8 volume, one shot.
- [ ] Notification handler: `{ shouldShowBanner, shouldShowList, shouldPlaySound, shouldSetBadge }`;
      moment behaviour = banner false, list false, sound true. Update `moment-sound.test.ts`.
- [ ] Gate: `pnpm typecheck && pnpm lint && pnpm test`; web export of each app; `npx expo-doctor`.
- [ ] Commit "Expo SDK 53 (React 19, RN 0.79): expo-av replaced by expo-audio".

## Task 2: SDK 54

- [ ] `npx expo install expo@^54.0.0 && npx expo install --fix` per app; `react-native-worklets` comes in
      with Reanimated 4.
- [ ] `babel.config.js`: `presets: ['babel-preset-expo']` only (the preset adds the worklets plugin).
- [ ] Fix Reanimated 4 API breaks (`useAnimatedGestureHandler` gone, `useWorkletCallback` gone,
      `combineTransition`, spring config `restDisplacementThreshold`/`restSpeedThreshold` gone).
- [ ] packages/ui ranges; gate; commit "Expo SDK 54 (RN 0.81, Reanimated 4)".

## Task 3: SDK 55

- [ ] Install/fix per app; remove `newArchEnabled` from the three `app.json`; packages/ui ranges; gate;
      commit "Expo SDK 55 (RN 0.83, new architecture only)".

## Task 4: SDK 56

- [ ] Install/fix per app; check `@react-navigation/*` imports (none expected), the live SSE stream with
      `expo/fetch` as global fetch (web unaffected), TS 6 if expo-doctor asks; packages/ui ranges; gate;
      commit "Expo SDK 56 (RN 0.85)".

## Task 5: SDK 57

- [ ] Install/fix per app; packages/ui ranges; gate; commit "Expo SDK 57 (RN 0.86)".

## Task 6: Verify and document

- [ ] `npx expo-doctor` per app — fix or explain each finding.
- [ ] After shots with the same script; pixel-compare against before; no new console errors.
- [ ] Dev start: `npx expo start --web --port 8091` in apps/customer with its demo API, load in Playwright, stop.
- [ ] Config plugins: copy an app to a temp dir, `npx expo prebuild --no-install --platform android`,
      discard.
- [ ] Docs: CLAUDE.md SDK line, `docs/deploy/mobile.md` (SDK, Expo Go note), READMEs naming expo-av.
- [ ] `git fetch && git rebase origin/main`; lockfile conflicts → `pnpm install` + `npx expo install --fix`
      per app; full gate again.
