# TravelBoast (travel-map) — Codebase Audit: Post-Mortem & Remediation Plan

> **Remediation status (2026-07-03):** all phases implemented on this branch.
>
> | Phase | Commit | Findings closed |
> |-------|--------|-----------------|
> | 0 — process guardrails | `39c2a7a` | F23, F24, F26, F27 |
> | 1 — P0 bugs | `76e8f73` | F1, F2, F3, F4 |
> | 2 — state model | `cdf07c4` | F5, F6, F7, F13, F19 |
> | 3 — GPX robustness | `4fa42e6` | F8, F21 (F20: by-design comment) |
> | 4 — recording fidelity + perf | `0a0950e` | F9 (option A), F11, F12, F28 (duration-lock) |
> | 5 — map editor hardening | `33d2a33` | F10, F15, F16, F17, F18 |
> | 6 — bundle/asset diet | (this commit) | F14, F22, F25 |
>
> Remaining open items: F20 full mitigation (imported-route preservation on edit)
> and the cosmetic F28 leftovers (backdrop tint consistency, two-finger-tap guard) —
> both deliberately deferred as noted in the plan below.

**Date:** 2026-07-03 · **Scope:** full source (~3,900 LoC), build config, CI, assets
**Method:** line-by-line review of all 17 source files, clean build + typecheck, and
**live browser verification** of suspected bugs with Playwright against a running dev
server (map style stubbed locally so `load` fires without network tiles).

---

## Executive summary

The app is in good functional shape: it builds clean, has no type errors, and the core
flows (add waypoints → route → tap-to-insert → preview → record → download) all work,
which was verified end-to-end in a headless browser. The problems fall into four themes:

1. **Silent failure modes** — a failed model load hangs the animation and the recorder
   forever; the map "error-retry" logic can be triggered by any transient tile error;
   GPX import can crash on large files; there is no user-visible error surface anywhere
   except the GPX toast.
2. **Verified UX regressions** — the Download button renders dim (40 % white, looks
   disabled) even when the video is ready, defeating the intent of commit `0367f31`;
   picking a vehicle pollutes undo history with 3 entries; redo exists in the reducer
   but has no UI.
3. **Resource leaks** — MediaRecorder is never stopped when leaving preview; the Three.js
   layer never disposes geometries/materials/textures across preview sessions.
4. **Process/hygiene drift** — `CLAUDE.md` points the mandatory version bump at a
   component that is dead code (`MenuDrawer.tsx` is never rendered); the deploy workflow
   still auto-deploys pushes to a stale feature branch; ~5 MB of unused GLBs ship in the
   artifact; no lint config, no tests, single 1.67 MB JS chunk.

Nothing found is data-destroying for the user beyond undo-history quirks; the two
highest-priority items are the hung-recorder failure mode (battery/memory on iOS, the
primary target platform) and the Download-button regression (verified live).

---

## Findings

Severity: **P0** = user-visible breakage or unbounded resource use · **P1** = wrong
behaviour users will hit · **P2** = correctness/robustness edge case, perf · **P3** =
hygiene, dead code, docs.

### P0 — Critical

| # | Finding | Evidence |
|---|---------|----------|
| **F1** | **Download button looks disabled when video is ready** (verified in browser: computed color `rgba(255,255,255,0.4)`). Conflicting Tailwind classes `text-white` (ready state) and `text-white/40` (idle state) are both emitted; stylesheet order — not class order — decides, and `/40` wins. Regression against the stated intent of commit `0367f31` ("plain white when ready"). | `src/components/AnimationPlayer.tsx:550-562` |
| **F2** | **MediaRecorder never stopped on leaving preview.** The mount-effect cleanup restores markers/layers but never touches `mediaRecorderRef`. Tapping ← Back mid-playback leaves the canvas `captureStream(30)` + encoder running indefinitely (battery drain, memory growth; iOS Safari is the main target). Re-entering preview starts a *second* recorder while the first still runs. | `src/components/AnimationPlayer.tsx:161-188` |
| **F3** | **Animation + recording hang forever if a model fails to load.** `animate()` keeps scheduling rAF until `layer.isFullyDone()`, but `singleDisappearStart` is only ever set inside `VehicleLayer.render()`, which early-returns when no model is loaded (`if (!this.model && !this.outgoing && !hasTrain) return`). A 404/parse failure on a GLB/FBX (only `console.warn`ed) therefore means: rAF loop never exits, button says "Preparing…" forever, recorder records forever. | `src/components/AnimationPlayer.tsx:296-298`, `src/components/VehicleLayer.ts:88-97, 466, 231` |
| **F4** | **Map `error` handler conflates tile errors with style-load failure.** `map.on('error')` fires for *any* error event (missing glyph, transient tile 404/network blip) before `loadSucceeded` flips true. Each firing schedules another `setStyle(...)`, restarting the style load that may have been progressing fine; after 3 it silently rotates the user to a different map style. On flaky mobile connections this makes initial load slower and non-deterministic. | `src/components/MapEditor.tsx:234-250` |

### P1 — Major

| # | Finding | Evidence |
|---|---------|----------|
| **F5** | **One vehicle pick = three undo entries.** `onSelect` dispatches `SET_VEHICLE`, `SET_COLOR`, `SET_ANIMATION` separately; each passes through `historyReducer` and pushes a history frame. Undo after picking a red SUV first reverts animation (a no-op — see F13), then color, then vehicle. | `src/App.tsx:130-134`, `src/hooks/useWaypoints.ts:239-245` |
| **F6** | **Redo is implemented but unreachable.** `REDO` action, `canRedo`, and future-stack all exist and work; no UI element dispatches it. Destructive-ish actions (Clear all, double-tap remove) are only half-recoverable in practice. | `src/hooks/useWaypoints.ts:229-237`, `src/App.tsx:13` (destructured, unused), `src/components/Toolbar.tsx` |
| **F7** | **Segment metadata silently lost on remove/insert.** `REMOVE_WAYPOINT`'s reconnect segment drops `animation` and resets `manualVehicle:false` (a segment the user explicitly set reverts to auto-propagation); `INSERT_WAYPOINT`'s two child segments likewise drop `animation` and `manualVehicle`. Bézier `handles` are dropped too (defensible, but combined with F20 this surprises GPX users). | `src/hooks/useWaypoints.ts:76-100, 105-152` |
| **F8** | **GPX import can crash on large files.** `Math.min(...lngs)` / `Math.max(...lats)` spread the full point array onto the call stack — real-world GPX tracks (10k–200k points) exceed V8's ~65k argument limit and throw `RangeError`. Additionally `FileReader` has no `onerror`, so a read failure does nothing at all (no toast). | `src/utils/gpx.ts:65-70`, `src/App.tsx:56-73` |
| **F9** | **Exported video does not contain the km counter or arrival flag.** Recording captures only the WebGL canvas; the red km badge, and the 🚩 arrival marker are DOM overlays. The in-app "📍 km" toggle strongly implies the counter is part of the video — users will discover the mismatch only after sharing. Needs a product decision: draw them into the canvas (custom layer / 2D compositing) or stop implying they're recorded. | `src/components/AnimationPlayer.tsx:396-422 (canvas-only stream), 467-471, 311-320 (DOM overlays)` |
| **F10** | **Map tile attribution is hidden.** `attributionControl: false` plus CSS `display:none` on both ctrl corners. OSM-derived tiles (OpenFreeMap) require ODbL attribution and Carto's free basemaps contractually require their attribution. Compliance risk for a publicly deployed app. | `src/components/MapEditor.tsx:152`, `src/index.css` (`.maplibregl-ctrl-bottom-*`) |

### P2 — Moderate (correctness edges, perf, leaks)

| # | Finding | Evidence |
|---|---------|----------|
| **F11** | **GPU resources never disposed.** `VehicleLayer.onRemove` removes objects from the scene but disposes nothing (geometries, materials, skin/atlas textures); a fresh `THREE.WebGLRenderer` is constructed on every preview entry. `ThumbRenderer` keeps every model + PNG data-URL forever (bounded but ~MBs). Long sessions on iOS accumulate GPU memory. | `src/components/VehicleLayer.ts:634-643`, `src/utils/thumbRenderer.ts` |
| **F12** | **60 fps React re-renders during playback.** `setProgress`/`setKmTraveled` run every frame, re-rendering the whole control panel; `progress` state is otherwise only used for nothing visible (no progress bar renders it — only `kmTraveled` is shown). Also `interpolateAlong` + `sliceRoute` each recompute `turf.length` over the full polyline every frame (O(n) twice per frame). | `src/components/AnimationPlayer.tsx:243-248`, `src/utils/routing.ts:80-112` |
| **F13** | **Vestigial `animation` plumbing.** Since the animation picker was removed (`38e2448`), `animation` is always `null`: `SET_ANIMATION` action, `Segment.animation`, `applyVehicle`'s unused `animation` parameter, `resolveAnimUrl` (returns `cfg.animUrl` verbatim), and the CustomEvent payload all carry dead data. `jump.fbx` (552 kB) is shipped but unreferenced. | `src/types/index.ts:24,49`, `src/components/AnimationPlayer.tsx:15`, `src/utils/vehicles.ts:126-128` |
| **F14** | **`computeRoute` ignores the vehicle; `greatCircleArc` is dead.** Every handle-less segment is a straight rhumb-ish line — ocean liners crossing the Atlantic get a chord, not a great circle, even though the great-circle helper exists and is never called. `routeMidpoint` is also unused. | `src/utils/routing.ts:9-36, 73-77` |
| **F15** | **Marker churn: every state change recreates every waypoint marker** (remove + rebuild DOM, re-attach 10 listeners each) even for unrelated changes; the `visibility:hidden` + rAF trick exists purely to hide the resulting flash. Drags already dispatch `MOVE_WAYPOINT` → full rebuild mid-interaction. | `src/components/MapEditor.tsx:404-445` |
| **F16** | **Duplicated stale-handle cleanup block** — the same "remove handle markers for missing segments" loop appears twice in one effect. | `src/components/MapEditor.tsx:569-576, 631-637` |
| **F17** | **Redundant style rebuild on mount** (verified: console warning "Unable to perform style diff … Rebuilding the style from scratch"). The `[mapStyle]` effect runs at mount and calls `setStyle` on the style the constructor is already loading. Harmless today but doubles style work on startup and is the kind of latent race F4 amplifies. | `src/components/MapEditor.tsx:284-334` |
| **F18** | **`waitForStyle` polling leak** — the route-sync effect retries `getSource('routes')` via naked `setTimeout` every 100 ms with no cancellation on unmount/re-run; if the source never appears (see F4 wiping sources) it polls forever. | `src/components/MapEditor.tsx:641-659` |
| **F19** | **Reconnect-segment ID collisions possible** — `seg-${Date.now()}` without a random suffix (unlike every other ID in the codebase). Two removals in the same millisecond (undo/redo replays, double-dispatch) collide. | `src/hooks/useWaypoints.ts:80` |
| **F20** | **Editing an imported GPX route destroys its geometry.** Moving any waypoint runs `recomputeSegment`, which replaces the detailed GPX polyline with a straight line (handles are empty). No warning. Combined with F8's silent failure it makes GPX support feel untrustworthy. | `src/hooks/useWaypoints.ts:15-29`, `src/utils/gpx.ts` |
| **F21** | **GPX sub-path search bug** — after building segment *i*, `searchFrom` is set to `fromIdx` instead of `toIdx`, so the next segment's search re-scans from the previous segment's *start*; on self-crossing tracks a segment can snap to the wrong pass over the same area. | `src/utils/gpx.ts:103` |
| **F22** | **1.67 MB single JS chunk** (457 kB gz). Three.js + MapLibre + all of `@turf/turf` (namespace import defeats tree-shaking; only ~7 turf functions are used). No manualChunks, no dynamic import of the preview stack. | `vite.config.ts`, all `import * as turf` sites |

### P3 — Hygiene, dead code, process

| # | Finding | Evidence |
|---|---------|----------|
| **F23** | **`MenuDrawer.tsx` is dead code — and `CLAUDE.md`'s mandatory version-bump rule points at it.** The component is never imported; the *rendered* version string lives in `MapStylePicker.tsx:123`. Any contributor following CLAUDE.md to the letter bumps a string nobody sees. | `src/components/MenuDrawer.tsx`, `CLAUDE.md` |
| **F24** | **Deploy workflow auto-deploys a stale feature branch.** `deploy.yml` triggers on `main` *and* `claude/travel-video-generator-fQ86O`; CLAUDE.md still names that branch as the dev branch. Any push there goes straight to production Pages. | `.github/workflows/deploy.yml:4-5` |
| **F25** | **~5 MB of unused assets ship in the artifact**: everything under `public/vehicles/_extras/` except `_extras/train/*` (boats, ships, delivery, sedan-sports…), plus unused `colormap.png`, `car-colormap.png`, `watercraft-colormap.png`, top-level `locomotive.glb`/`tram.glb`/`subway.glb`/`bullet-train.glb` (superseded by `partUrls`), `jump.fbx`, `flag-high.glb` (arrival flag is an emoji now). `public/` is 14 MB; the actually-referenced set is ~6 MB. | `public/vehicles/` vs `src/utils/vehicles.ts` |
| **F26** | **No ESLint config, no tests, no CI quality gate.** Source contains `eslint-disable` comments but there is no eslint config or dependency; `package.json` has no test/lint scripts; deploy runs build only. The reducer (`useWaypoints`) and `gpx.ts` are pure functions begging for unit tests. | repo root, `package.json` |
| **F27** | **README is one line**; no setup/dev/deploy documentation. | `README.md` |
| **F28** | Minor UX inconsistencies: VehicleSelector/MapStylePicker backdrops are fully transparent (MenuDrawer's had `bg-black/40`); duration slider is locked ~0.8 s after entering preview because auto-play kicks in; `tintTexture` assumes 6-digit hex (fine for the fixed palette, fragile if a color picker is ever added); two-finger taps can count toward double-tap-remove. | various |

---

## Remediation plan

Ordered by implementation sequence. Each phase is a coherent, independently shippable
block; later phases depend on earlier ones only where noted. Per repo policy, every
user-facing phase bumps the version string (after **Phase 0** makes that rule sane).

### Phase 0 — Process & guardrails *(do first; ~1 h; zero user-facing risk)*
Fixes: **F23, F24, F26 (config part), F27**

1. `deploy.yml`: remove `claude/travel-video-generator-fQ86O` from the push triggers
   (keep `main` + `workflow_dispatch`).
2. Delete `src/components/MenuDrawer.tsx`; update `CLAUDE.md` to point the version-bump
   rule at `src/components/MapStylePicker.tsx` (or, better, hoist the version into a
   single `src/version.ts` constant rendered by MapStylePicker, and point CLAUDE.md at
   that). Update CLAUDE.md's stale branch instruction.
3. Add ESLint (flat config, `typescript-eslint` + `react-hooks`) and a `lint` script;
   add Vitest with a `test` script; wire `lint` + `test` + `tsc` into the deploy
   workflow before build.
4. Write a minimal README (what it is, `npm run dev`, deploy model, asset origins).

*Verification:* CI green on a no-op PR; `npm run lint`/`test` pass locally.

### Phase 1 — Critical bug fixes *(P0s; ~half a day)*
Fixes: **F1, F2, F3, F4** — one commit each, version bump.

1. **F1 Download button**: make the class list mutually exclusive — compute one color
   class: `videoReady ? 'bg-white/30 text-white' : isPlaying ? 'bg-white/20 text-white/60' : 'bg-white/20 text-white/40'`.
   *Verify:* computed `color` is `rgb(255,255,255)` when ready (re-run the Playwright probe).
2. **F2 Recorder lifecycle**: in the preview-mount effect's cleanup (and in `onBack`),
   stop the recorder and its stream:
   `recordingCompletedRef.current = false; mediaRecorderRef.current?.state === 'recording' && mediaRecorderRef.current.stop(); mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop()); mediaRecorderRef.current = null;`
   Also stop tracks after every successful `onstop` to release the capture pipeline.
   *Verify:* leave preview mid-play; assert `recorder.state === 'inactive'` and stream tracks ended.
3. **F3 Hung animation on load failure**: give `applyVehicle`/`VehicleLayer` a load
   outcome. Simplest robust fix: in `animate()`, treat "progress ≥ 1 and layer has no
   model/train after a grace period (e.g. 2 s)" as done; additionally surface load
   failures — have `VehicleLayer` accept an `onLoadError` callback that AnimationPlayer
   uses to show a toast ("Couldn't load vehicle model") and stop playback + recorder
   cleanly. *Verify:* Playwright run with `page.route` 404-ing `sedan.glb`; assert Stop
   state is reached and recorder stopped.
4. **F4 Error-retry**: only trigger retry logic when the *style* fails — inspect the
   error event (`e.error` message / `e.sourceId === undefined` heuristics are brittle;
   prefer listening for `map.once('load')` timeout instead): keep a 10 s timer from
   construction; if `load` hasn't fired, retry same style ×3 then rotate. Ignore
   `error` events entirely once tiles are merely failing individually.
   *Verify:* stub style OK but 404 a tile source → no `setStyle` calls; stub style 404 → retries then rotates.

### Phase 2 — State-model correctness *(P1 data/undo issues; ~half a day)*
Fixes: **F5, F6, F7, F13, F19** — touches only `types`, `useWaypoints`, `App`, `VehicleSelector`, `Toolbar`.

1. **F13 first** (shrinks the surface): delete `SET_ANIMATION`, `Segment.animation`,
   the `animation` params in `onSelect`/`applyVehicle`/CustomEvent payload, and
   `resolveAnimUrl` (inline `cfg.animUrl`). Delete `jump.fbx` with F25 or here.
2. **F5**: replace the App-side triple dispatch with one atomic
   `SET_VEHICLE_AND_COLOR { segmentId, vehicle, color }` action (propagation logic of
   `SET_VEHICLE` + color assignment in one reducer case) → exactly one history frame.
3. **F7**: in `REMOVE_WAYPOINT` reconnect and `INSERT_WAYPOINT` children, carry over
   `manualVehicle` (and color already carried) from the source segment(s); document the
   deliberate `handles` reset in a comment.
4. **F19**: append the same random suffix used elsewhere to the reconnect segment ID.
5. **F6**: add a redo button (`↪`) next to undo in `Toolbar`, wired to `canRedo`/`REDO`.
   Keep the 2+2 symmetry by pairing undo/redo in one visual cluster (or long-press undo
   → redo if toolbar space is the constraint; plain button preferred).
6. **Tests (uses Phase 0 Vitest):** unit tests for `travelReducer`/`historyReducer`
   covering: atomic vehicle+color undo, remove-middle-waypoint metadata carry-over,
   insert-waypoint ordering, history cap, redo.

### Phase 3 — GPX robustness *(P1; ~2–3 h)*
Fixes: **F8, F20 (mitigation), F21**

1. Replace spread min/max with a single `for` loop (or `turf.bbox`).
2. Add `reader.onerror` → same toast path as parse failure.
3. `searchFrom = toIdx` (with a regression test using a figure-eight track).
4. F20 mitigation (cheap, no product change): when a segment whose `route` did not come
   from `computeRoute` (mark imported segments with `imported: true`) is recomputed,
   keep its polyline if neither endpoint moved; optionally show a one-time toast
   "Editing an imported route redraws it as straight lines".
5. Tests: large-file bounds (100k synthetic points), malformed XML, `rtept`-only files.

### Phase 4 — Recording & preview fidelity *(P1 product decision + P2 perf; ~1 day)*
Fixes: **F9, F12, F11, F28 (duration-lock)**

1. **F9** (needs a product call, two options):
   - *Option A (recommended):* render the km counter into the canvas — draw it in a
     small custom MapLibre layer or composite `captureStream` through an offscreen 2D
     canvas (`drawImage(mapCanvas)` + `fillText(km)` per frame, record that canvas).
     The offscreen-composite approach also lets the arrival 🚩 be stamped in.
   - *Option B:* stop implying it — move the km toggle out of the recording panel and
     label the download "map animation only".
2. **F12**: stop calling `setProgress` per frame (drive the km badge via a
   `requestAnimationFrame`-updated DOM ref or throttle state to 4 Hz); precompute the
   route's cumulative length table once per preview entry and make
   `interpolateAlong`/`sliceRoute` binary-search it instead of re-measuring per frame.
3. **F11**: implement `disposeHierarchy` (geometry, material, material.map/normal maps)
   called from `_clearTrainParts`, model swaps, and `onRemove`; keep a single shared
   `WebGLRenderer` across preview sessions if MapLibre's custom-layer contract allows it
   (it does — cache per canvas/context), else at least dispose the old one.
4. **F28 duration-lock**: allow changing "Video length" while stopped *after* a run
   without the resume-speed jump: on duration change, clear `resumeFromRef` (restart
   semantics) — one-line predictable behaviour.

### Phase 5 — Map editor hardening *(P2; ~half a day)*
Fixes: **F15, F16, F17, F18, F10**

1. **F10 attribution** (small but user-visible; legally shippable before the perf work):
   re-enable `attributionControl` compact mode, drop the CSS `display:none`, keep it
   out of the recorded canvas (it's DOM, so it already is).
2. **F15**: only rebuild a waypoint marker when its *element content* must change
   (vehicle emoji / first-last status). Diff: keep `createWaypointEl`'s inputs in a
   `data-` signature on the element; if unchanged, just `setLngLat`. Kills the
   visibility/rAF flash workaround.
3. **F16**: delete the duplicated cleanup block.
4. **F17**: skip the `[mapStyle]` effect on first run (`useRef` guard) so mount doesn't
   double-load the style.
5. **F18**: convert `waitForStyle` polling to `map.once('styledata', …)` with proper
   effect cleanup (clear timeout / remove listener on unmount).
6. Re-run the Playwright probes (kept from this audit in `scratchpad`; consider
   promoting them to `e2e/` with the stubbed style JSON committed as a fixture).

### Phase 6 — Payload & dead-code diet *(P2/P3; ~2–3 h)*
Fixes: **F22, F25, F14, F26 (remaining)**

1. **F25**: delete unused assets (everything in `_extras/` except `train/`, unused
   colormaps, superseded top-level train GLBs, `jump.fbx`, `flag-high.glb`) — keep them
   recoverable in git history. Artifact drops ~5–6 MB.
2. **F22**: replace `import * as turf from '@turf/turf'` with per-package imports
   (`@turf/length`, `@turf/along`, `@turf/line-slice-along`, `@turf/nearest-point-on-line`,
   `@turf/great-circle`, `@turf/simplify`, `@turf/destination`, `@turf/bearing`,
   `@turf/helpers`); add `manualChunks` for `three` and `maplibre-gl`; consider
   `import()`-lazy-loading `VehicleLayer`/three from AnimationPlayer (three is only
   needed at preview time; thumbnails already lazy-init on selector open).
3. **F14**: either use `greatCircleArc` for Boats-category handle-less segments longer
   than ~500 km (nice product win, trivially available) or delete it and `routeMidpoint`.
   Recommendation: use it — the code is already written and tested by turf.
4. Enable `noUnusedLocals`/`noUnusedParameters` in `tsconfig.json` once dead code is gone.

### Explicitly deferred (document, don't build now)
- F28 backdrop-tint consistency and two-finger-tap guard: cosmetic, fold into any
  future touch-handling work.
- Persisting trips to localStorage, route-vehicle-aware routing (roads/sea lanes): out
  of audit scope, listed for roadmap only.

### Suggested effort/sequencing summary

| Phase | Contents | Effort | Risk | Ship gate |
|-------|----------|--------|------|-----------|
| 0 | Process, CI, dead code rule fix | ~1 h | none | CI green |
| 1 | P0 bugs (button, recorder, hang, retry) | ~0.5 d | low | Playwright probes pass |
| 2 | Undo/redo & state model | ~0.5 d | medium (reducer) | new unit tests |
| 3 | GPX robustness | ~2–3 h | low | unit tests |
| 4 | Recording fidelity + perf | ~1 d | medium (product call on F9) | manual iOS check |
| 5 | Map editor hardening + attribution | ~0.5 d | low | probes + visual check |
| 6 | Bundle/asset diet | ~2–3 h | low | build size budget (<900 kB main chunk, <8 MB public) |

Total: ~3.5 focused days. Phases 1–3 are independent of each other after Phase 0 and
can be parallelised across agents/contributors; Phase 4's F9 needs a product decision
before implementation.
