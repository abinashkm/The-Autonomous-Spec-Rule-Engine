---
description: Create a draft spec via the interview wizard (ADR-010 agent mode).
allowed-tools:
  - Read
  - Write
  - mcp__specgate__get_active_spec
  - mcp__specgate__list_tasks
---

Walk the user through the 7-question SpecGate interview (`name`, `who`, `problem`, `success`, `scenarios`, `nonFunctional`, `outOfScope`). When they're done:

1. Call `mcp__specgate__get_active_spec` first to confirm there isn't already an in-progress draft.
2. Write the draft to `.specgate/specs/<NNN>-<slug>/requirements.md` using the §7.1 Markdown layout.
3. Remind the user to run `specgate spec validate <SPEC-id>` and then `specgate spec approve <SPEC-id>` when the ACs look right.

Scenarios should be phrased as "Given X, when Y, then Z" so the validator doesn't flag them as `E_UNTESTABLE_AC`.
