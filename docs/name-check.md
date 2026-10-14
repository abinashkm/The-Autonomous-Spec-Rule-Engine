# Product name availability — SpecGate

> run.md §21.2 row 1 + §21.5 row 1 — availability cannot be verified offline.
> This document records the state of each channel. **Do not block M0 on this** (§21.2 row 1).

**Current working name:** `SpecGate` (constant `PRODUCT_NAME` lives in [packages/core/src/constants.ts](../packages/core/src/constants.ts)).

**Fallback order** (same change set, under an hour per the plan):
1. `specrail`
2. `railspec`
3. `specward`

## Channels

| Channel | Status | Checked on | Checked by | Notes |
|---|---|---|---|---|
| npm — `specgate` | TBD | — | — | `npm view specgate` or https://www.npmjs.com/package/specgate |
| npm — `@specgate/*` scope | TBD | — | — | `npm view @specgate/cli` |
| GitHub org `specgate` | TBD | — | — | https://github.com/specgate |
| Domain `specgate.dev` | TBD | — | — | Any WHOIS / registrar |
| Domain `specgate.io` | TBD | — | — | Any WHOIS / registrar |
| Domain `specgate.sh` | TBD | — | — | Any WHOIS / registrar |
| Trademark (word-mark search) | TBD | — | — | USPTO TESS (https://tmsearch.uspto.gov/) + EUIPO eSearch (https://euipo.europa.eu/eSearch/) |

## How to run the check

Run this exact set of commands when you have internet, then paste results above.

```bash
npm view specgate 2>&1 | head -1
npm view @specgate/cli 2>&1 | head -1
curl -sI https://github.com/specgate | head -1
# whois queries vary by TLD — easiest is a browser check at Namecheap / Porkbun.
# Trademark: open USPTO TESS and EUIPO eSearch, search "SpecGate" as word mark.
```

## If any check fails

1. Pick the next available fallback.
2. Update the `PRODUCT_NAME` constant in `packages/core/src/constants.ts`.
3. Update the `name` field in each `packages/*/package.json` and the scope in `pnpm-workspace.yaml`.
4. Update references in `run.md` (the title, §25.1 one-liner, etc.) and `PLAN.md`.
5. Rebuild + rerun tests.

The rename should land in a single commit; the plan budgets <1h for this.
