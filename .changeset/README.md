# Changesets

Hi! This directory holds [changesets](https://github.com/changesets/changesets) — one file per unreleased change.

- To record a change: `pnpm changeset`
- To bump versions + update CHANGELOG: `pnpm changeset version`
- To publish (CI only): `pnpm changeset publish`

See `.changeset/config.json` for the linked-group policy (`@specgate/core`, `@specgate/cli`, `@specgate/mcp`, `@specgate/hooks` move together).
