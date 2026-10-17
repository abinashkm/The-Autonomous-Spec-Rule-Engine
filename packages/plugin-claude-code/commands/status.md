---
description: Show the per-AC traceability matrix (untested / passing / failing / done).
allowed-tools:
  - Bash(specgate status:*)
---

Run `specgate status` for the human-readable table or `specgate --json status` for the machine-readable matrix.

Filter flags:

- `--untested-only` — ACs with no test referencing them.
- `--failing-only` — ACs whose linked tests are failing.
- `--orphans` — tests referencing AC ids that don't exist in any spec.

An AC is `done` iff it has at least one linked test AND every task that `implements:` it is checked.
