# Claude Code guidelines for travel-map

## Version bumping

Every commit that changes user-facing code **must** update the `VERSION` constant in
`src/version.ts` (rendered at the bottom of the map-style picker sheet).

Format: `vYYYYMMDD-N` where N resets to 1 each day and increments if there are
multiple user-facing changes on the same day (e.g. `v20260519-1`, `v20260519-2`).

## Quality gates

Before pushing, run and pass:

- `npm run lint`
- `npm test`
- `npm run build` (includes `tsc`)

The deploy workflow enforces the same gates.

## Branches & deployment

Develop on a feature branch and open a PR into `main`. Deploys to GitHub Pages
happen automatically on push to `main` only — never wire feature branches into
`.github/workflows/deploy.yml` triggers.
