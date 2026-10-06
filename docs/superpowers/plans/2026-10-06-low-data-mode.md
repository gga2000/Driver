# Low-Data Mode (SP9 q2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a slow connection — or when the person chooses — the customer and driver apps use less data: the drawn food art instead of photos, the drawn town instead of map tiles, and fewer refreshes.

**Architecture:** `@driver/ui` `network/data-saver.ts`: a preference (`auto` / `on` / `off`, stored by each app) and the connection (web: Network Information API `saveData` or 2G/3G; native: NetInfo cellular 2G/3G) give `useLiteMode()`. Lite: `FoodArt` skips remote photos; the web `BaseMap` (customer and partner) falls back to the SVG base; route, nearby-vehicle and demand-map refreshes run three times slower (`liteInterval`). `DataSaverCard` (shared) sits in the customer's notifications and settings screen and the driver's account tab.

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.9 (q2).

## Decisions

1. **SP9's other items belong to the customer joy program** (another session, Ali's board): reorder (o13), order ahead (o11), one search with Arabic folding (h4), invite as a gift (g2). Not duplicated here.
2. **No image resizing service yet**: low-data shows the drawn art instead of a smaller photo; smaller photos need an image CDN (with SP2's Cloudflare account).

## Tasks

1. UI kit: `slow.ts` / `slow.native.ts`, `data-saver.ts` (+ tests), `DataSaverCard`, copy.
2. Customer: preference storage (+ test), FoodArt, BaseMap.web, route and nearby intervals, settings card.
3. Partner: preference storage, BaseMap.web, job route and demand-map intervals, account card.
4. Verify: checks; screenshots (blocked on this machine: the Expo bundler hangs for every app since 2026-10-06 13:39, including the untouched merchant app — see the session notes), commit, push, CI.
