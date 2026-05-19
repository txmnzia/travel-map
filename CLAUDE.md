# Claude Code guidelines for travel-map

## Version bumping

Every commit that changes user-facing code **must** update the version string in
`src/components/MenuDrawer.tsx` (the `<p>` at the bottom of the drawer).

Format: `vYYYYMMDD-N` where N resets to 1 each day and increments if there are
multiple deployments on the same day (e.g. `v20260519-1`, `v20260519-2`).

## Branch

Develop on `claude/travel-video-generator-fQ86O`, push to `main` when done.
