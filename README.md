# SpecGate

> CLI-first, local-first guardrails for AI coding agents: **spec before code, rules while coding, gates before merge.**

[![ci](https://github.com/abinashkm/The-Autonomous-Spec-Rule-Engine/actions/workflows/ci.yml/badge.svg)](https://github.com/abinashkm/The-Autonomous-Spec-Rule-Engine/actions/workflows/ci.yml)
[![license: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**One-line:** SpecGate makes AI coding agents build what you specified, the way your project requires, and proves it before the code merges.

**Analogy:** _CI for AI intent._ A linter checks syntax; SpecGate checks that the agent's work matches the requirements and architecture you agreed on, and sends the agent back to fix what doesn't.

---

## Why this exists

AI coding agents (Claude Code, Cursor, Copilot, Codex, Gemini CLI) are fast but:

- **Drift.** They forget earlier decisions and produce inconsistent code across files + sessions.
- **Architecture + security slips.** Working code that breaks layering, bypasses patterns, or leaks secrets slides through.
- **Unverifiable "done".** The agent says "finished" with no proof tied to requirements.

Reviewing those diffs by hand doesn't scale. SpecGate closes the loop:

```
Define spec  →  Inject only relevant rules  →  Agent codes  →  Gates verify  →  Failures fed back  →  Done = provable
```

The differentiator is **verification + feedback**, not spec generation. Spec templates are commodity; proving code matches spec + rules, then driving the agent to fix violations, is the product.

---

## Who it's for

| Persona               | Pain                                       | What SpecGate gives them                                                                 |
| --------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Solo "vibe coder"     | Agent breaks things silently, secrets leak | Safe defaults, plain-English failures, one-command setup                                 |
| Small team            | Each person's agent codes differently      | Shared rules + gates, same results across agents                                         |
| Tech lead / reviewer  | Reviewing AI diffs is exhausting           | Automated pre-checks, requirement-to-test traceability, a `status` matrix proving "done" |
| Security / compliance | Unvetted AI code reaching main             | Mandatory gates, non-bypassable CI backstop, audit trail in git trailers                 |

---

## Before / after example

**Without SpecGate:** _"Add CSV export."_

The agent adds an endpoint, hardcodes an API key in config, queries the DB from the controller, writes no tests. Looks fine in the demo. Breaks in prod.

**With SpecGate:**

- Spec declares `REQ-001 / AC-001.1 / AC-001.2`.
- The agent gets only backend + export rules (not the whole rulebook).
- On commit: `gitleaks` blocks the key, `architecture` flags the controller→DB import, `status` shows `AC-001.2 untested`.
- The fix prompt lists exactly those three items and forbids weakening gates to pass.
- After one retry, everything is green; `specgate status` shows `REQ-001 done`.

---

## Quickstart (5 minutes)

### Option 0 — just the CI backstop (no local install)

Add to any GitHub repo:

```yaml
# .github/workflows/specgate.yml
name: specgate
on: [pull_request]
jobs:
  specgate:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: abinashkm/The-Autonomous-Spec-Rule-Engine/packages/action@main
```

PR comments + SARIF code-scanning annotations arrive automatically. **Zero-risk trial.**

### Option 1 — individual dev

```bash
# JS/TS devs
npx @specgate/cli init

# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/abinashkm/The-Autonomous-Spec-Rule-Engine/main/packages/distribution/install.sh | sh

# Windows (PowerShell)
iwr -useb https://raw.githubusercontent.com/abinashkm/The-Autonomous-Spec-Rule-Engine/main/packages/distribution/install.ps1 | iex
```

Then:

```bash
specgate init                 # detect stack, write config, inject AGENTS.md block
specgate spec new             # 7-question interview → draft requirements.md
specgate spec approve SPEC-001
specgate check                # run gates
specgate status               # traceability matrix
```

See [docs/quickstart.md](docs/quickstart.md) for the full 5-minute walkthrough.

### Option 2 — Claude Code power user

Install the plugin from `packages/plugin-claude-code/` (see its [README](packages/plugin-claude-code/README.md)). You get:

- `/specgate:init`, `/specgate:spec`, `/specgate:check`, `/specgate:status` slash commands
- `PostToolUse` hook: fast secrets check on every file edit
- `Stop` hook: full `specgate check` before Claude ends a turn
- MCP server with 7 tools: `get_active_spec`, `get_task_context`, `list_tasks`, `update_task`, `check`, `get_rule`, `propose_spec_change`

---

## What's in the box

| Command                                                           | Purpose                                                                                                                 |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `specgate init`                                                   | Zero-config setup — detect stack, write `.specgate/config.yaml`, inject AGENTS.md block, install git hooks              |
| `specgate spec new / validate / approve / plan / tasks / list`    | Spec engine with stable IDs + immutability after approval                                                               |
| `specgate check [--staged] [--changed] [--gate x] [--fix-prompt]` | Run gates (secrets · lint · tests), emit the fix prompt on failure                                                      |
| `specgate status [--untested-only] [--failing-only] [--orphans]`  | Traceability matrix: REQ → AC → task → test → done?                                                                     |
| `specgate report --format sarif\|md\|json\|terminal`              | Render the last check in the chosen format                                                                              |
| `specgate doctor [--install]`                                     | Probe for required tools; with `--install`, download pinned checksum-verified binaries into `~/.specgate/bin` (ADR-015) |
| `specgate hooks install / claude-code`                            | Install git hooks (detects husky/pre-commit/lefthook); write `.claude/settings.json`                                    |
| `specgate mcp`                                                    | Start the MCP stdio server                                                                                              |
| `specgate uninstall [--purge]`                                    | Reverse everything `init` did — repo is byte-identical when `--purge` is passed                                         |

Exit codes: `0` pass · `1` blocking failure · `2` tool/config error · `3` warn-only with `--fail-on-warn`.

---

## Design invariants

- **Deterministic gates, advisory AI.** Pass/fail is decided by wrapped tools (gitleaks, eslint, ruff, vitest, …); LLMs only produce prose (specs, fix prompts).
- **Local-first, no telemetry.** All core features run offline. Any network use (pack updates, `doctor --install`) is explicit and user-triggered.
- **Everything is files.** State lives in plain, diffable, git-tracked files under `.specgate/`. No database.
- **Native surfaces, not interception.** We integrate via AGENTS.md, MCP, git hooks, CI — not by proxying agent prompts. (ADR-003)
- **Graduated strictness.** `advisory` → `standard` → `strict`. Never strict by default.
- **Verification, not generation.** SpecGate verifies code matches spec + rules; it is **not an agent** and does not write code for you.
- **Secrets never leak.** gitleaks matches are redacted in every report, fix prompt, and log. (§22.6)

---

## FAQ (short)

**Does my code leave my machine?** No. Core features run locally with no network and no telemetry by default.

**Does it replace my AI agent?** No. It works with Claude Code, Cursor, Copilot, Codex, Gemini CLI, or any other agent — and with none of them.

**Do I have to write specs by hand?** No. A 7-question interview generates the spec; inside an agent, the agent asks the questions and writes it for you.

**Will it slow me down?** The commit-time path targets under 5 seconds. Heavy checks (full tests, dependency audit) run in CI only.

**What if it blocks something that is actually fine?** Start in `advisory` (warn only). Any rule can be disabled or baselined with a recorded reason in `config.yaml`.

**Can I bypass it?** Locally you can (`git commit --no-verify`), because hooks cannot be mandatory. CI cannot be bypassed, which is the point.

**Is it only for new projects?** No. `specgate scan` (post-MVP) builds a baseline of existing violations so only _new_ problems block you. Change deltas let you spec incremental work.

**Which languages?** v1 targets JS/TS and Python with presets for common stacks. Secret scanning is language-agnostic. More via rule packs.

**Does it work in monorepos?** Config and rules can be scoped by path globs; first-class per-package config is a post-MVP item.

**What if the agent ignores AGENTS.md?** That's exactly why enforcement is separate from guidance: gates and CI catch what the agent ignores.

**How do I remove it?** `specgate uninstall` removes hooks + managed blocks; `specgate uninstall --purge` deletes `.specgate/` entirely. Verified to leave the repo byte-identical to the pre-`init` state.

More: [docs/when-a-check-fails.md](docs/when-a-check-fails.md).

---

## Repository layout

```
packages/
├── core/                 # all logic — stack detect, spec engine, gates,
│                         # trace, fix-loop, report, hooks, MCP tools
├── cli/                  # specgate / sg binary (commander-based)
├── mcp/                  # MCP stdio server
├── hooks/                # git-hook + Claude Code hook adapters
├── action/               # GitHub Action composite
├── plugin-claude-code/   # Claude Code plugin manifest + slash commands
└── distribution/         # Node SEA builds, Homebrew/Scoop manifests,
                          # install scripts, Dockerfile
packs/                    # first-party rule packs (post-MVP)
fixtures/                 # fixture repos for integration tests
schemas/                  # generated JSON Schemas (zod → JSON Schema)
docs/                     # handbook, quickstart, troubleshooting, …
```

**Dependency rule:** `cli`, `mcp`, `hooks`, `action` depend on `core`; `core` has no agent-specific code. See [run.md §22](run.md#22-instructions-for-ai-agents-working-on-this-repo).

---

## In-depth docs

- **[docs/handbook.md](docs/handbook.md)** — the full user + developer handbook (architecture, every CLI command, every MCP tool, config format, gate interface, rule packs, how to develop + release).
- **[docs/quickstart.md](docs/quickstart.md)** — 5-minute walkthrough.
- **[docs/when-a-check-fails.md](docs/when-a-check-fails.md)** — per-gate recovery guide.
- **[run.md](run.md)** — the design doc (ADRs, data formats, module boundaries, risks, roadmap). Humans + AI agents working on this repo read it before writing code.
- **[PLAN.md](PLAN.md)** — the micro-managed delivery plan (M0 → M8 → post-MVP).

---

## Status

MVP (M0 – M8) complete. **299 passing tests** (297 core + 2 MCP integration). Pilot gate per [run.md §21.4](run.md#214-success-metrics-and-kill-criteria-initial-targets-adjust-after-pilots) is next: 5–10 real repos, target < 5% false positives, ≥ 60% fix-loop resolution within 3 attempts, ≥ 50% retention after 4 weeks.

---

## Contributing

- Read [run.md §22](run.md#22-instructions-for-ai-agents-working-on-this-repo) before writing code — the invariants (all logic in `core`, schemas first, deterministic gates, no shell interpolation, redact secrets, write only inside managed blocks) are non-negotiable.
- `pnpm install && pnpm build && pnpm test` — all green on Linux / macOS / Windows.
- One concern per PR; include a commit trailer `Spec: <REQ/T ids>` (dogfooding from M3 onwards).

---

## License

Apache-2.0. First-party rule packs are **written originally**; third-party rule text is never bundled — only referenced (ADR-009). See [THIRD_PARTY.md](THIRD_PARTY.md).
