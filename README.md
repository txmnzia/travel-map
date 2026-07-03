# travel-map (TravelBoast)

A mobile-first travel-route animator: tap waypoints on a map, pick vehicles per
segment (cars, boats, trains, pedestrians), then play a 3D animated preview and
download it as a video. Built with React, MapLibre GL, and Three.js.

## Development

```bash
npm ci
npm run dev      # Vite dev server
npm run lint     # ESLint
npm test         # Vitest unit tests
npm run build    # tsc + production build (base path: /travel-map/)
```

## Architecture

- `src/hooks/useWaypoints.ts` — trip state (waypoints + segments) as a pure
  reducer wrapped in undo/redo history.
- `src/components/MapEditor.tsx` — MapLibre map, waypoint/handle markers,
  route GeoJSON sync, edit gestures.
- `src/components/AnimationPlayer.tsx` — preview mode: drives the animation
  loop, camera, trail, and MediaRecorder video export.
- `src/components/VehicleLayer.ts` — MapLibre custom layer rendering GLTF/FBX
  vehicle models with Three.js (multi-part trains, walkers with skeletal
  animation).
- `src/utils/` — routing/Bézier math, GPX import, vehicle catalog, thumbnail
  renderer, texture tinting.
- `public/vehicles/` — 3D model assets (Kenney.nl asset packs).

## Deployment

Pushes to `main` deploy to GitHub Pages via `.github/workflows/deploy.yml`
(lint + test + build gates). The user-visible version string lives in
`src/version.ts` — bump it with every user-facing change (see CLAUDE.md).

Map tiles: OpenFreeMap (OSM data) and Carto basemaps — attribution must remain
enabled.
