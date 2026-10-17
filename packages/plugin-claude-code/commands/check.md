---
description: Run SpecGate gates and surface the fix prompt on failure.
allowed-tools:
  - Bash(specgate check:*)
  - mcp__specgate__check
---

Prefer the MCP tool `mcp__specgate__check` so you get the structured `fixPrompt` payload. Fall back to `specgate check --fix-prompt` if MCP isn't available.

On blocking failures:

- Fix ONLY the items in the fix prompt. Do NOT edit `.specgate/config.yaml`, `baseline.json`, or any file under `.specgate/rules/` or `packs/` to make the gates pass (ADR-013).
- After fixing, run `specgate check` again until it exits 0.
- Attempts are tracked in `.specgate/state.json`; after `fix_loop.max_attempts` or when the same findings repeat, SpecGate stops and asks the human for help.
