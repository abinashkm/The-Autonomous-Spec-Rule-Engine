# SpecGate — Claude Code plugin

Bundles SpecGate's slash commands, hooks, and MCP server into a single Claude Code plugin.

## Install

```bash
# 1. Install the SpecGate CLI (if not already)
npm i -g @specgate/cli
# 2. Enable this plugin in your Claude Code plugin directory
#    (exact path depends on the Claude Code version — see the SDK docs).
```

## What you get

- `/specgate:init` — set up `.specgate/`, AGENTS.md block, hooks
- `/specgate:spec` — interview wizard → draft requirements.md
- `/specgate:check` — run gates, surface the fix prompt on failure
- `/specgate:status` — traceability matrix
- `PostToolUse` hook — fast secrets check on every file edit
- `Stop` hook — full `specgate check` before Claude ends a turn
- MCP server — exposes `get_active_spec`, `get_task_context`, `list_tasks`, `update_task`, `check`, `get_rule`, `propose_spec_change`
