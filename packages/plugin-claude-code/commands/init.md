---
description: Initialise SpecGate in this repo (detect stack, write config, inject AGENTS.md).
allowed-tools:
  - Bash(specgate init:*)
  - Read
---

Run `specgate init --yes` to:

1. Detect the project stack and cache `.specgate/stack.json`.
2. Write `.specgate/config.yaml` (keeps user content if already present).
3. Inject the managed AGENTS.md block (byte-safe: never clobbers user content).
4. Drop `.specgate/.gitignore` for reports + state.

After it runs, read `AGENTS.md` for the workflow contract and run `/specgate:spec` to describe your first feature.
