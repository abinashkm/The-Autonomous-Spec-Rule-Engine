# SpecGate — User + Developer Handbook

In-depth reference for everyone using, extending, or developing SpecGate. If you want the 5-minute version, read [quickstart.md](quickstart.md) first.

> This is a long document. Jump via the table of contents below. The source of truth for every architectural decision is [run.md](../run.md); this handbook translates it into something you can act on.

---

## Table of contents

1. [What SpecGate is (and isn't)](#1-what-specgate-is-and-isnt)
2. [System overview](#2-system-overview)
3. [Components](#3-components)
4. [On-disk layout in your repo](#4-on-disk-layout-in-your-repo)
5. [CLI reference](#5-cli-reference)
6. [MCP tools + resources](#6-mcp-tools--resources)
7. [Config format](#7-config-format)
8. [Gates — how they work + how to extend them](#8-gates--how-they-work--how-to-extend-them)
9. [Spec engine (requirements → tasks → traceability)](#9-spec-engine-requirements--tasks--traceability)
10. [Fix-loop + tamper gate](#10-fix-loop--tamper-gate)
11. [Hooks (git + Claude Code)](#11-hooks-git--claude-code)
12. [Reporters (terminal / JSON / SARIF / Markdown)](#12-reporters-terminal--json--sarif--markdown)
13. [Rule packs](#13-rule-packs)
14. [Development setup](#14-development-setup)
15. [Testing strategy](#15-testing-strategy)
16. [Release pipeline](#16-release-pipeline)
17. [Distribution channels](#17-distribution-channels)
18. [Security + privacy](#18-security--privacy)
19. [Troubleshooting](#19-troubleshooting)
20. [Roadmap + post-MVP](#20-roadmap--post-mvp)

---

## 1. What SpecGate is (and isn't)

**Is:** a verification + feedback layer around any AI coding agent. It encodes:

- **Spec before code** — a short interview turns a feature idea into numbered, testable acceptance criteria (`AC-xxx.y`).
- **Rules while coding** — the agent reads a small AGENTS.md plus task-specific rules pulled on demand (via MCP).
- **Gates before merge** — deterministic checks (secrets, lint, tests, architecture, spec coverage) run locally on commit and in CI. Pass/fail is decided by wrapped tools, never by an LLM.
- **Fix loop** — on blocking failures, a minimal correction prompt is written back to the agent with bounded retries.

**Is not:**

- Not an AI agent or code generator itself.
- Not a hosted SaaS or dashboard service.
- Not a replacement for code review.
- Not auto-converting natural-language rules into static-analysis rules (see run.md ADR-005).
- Not intercepting / proxying agent prompts (fragile; see ADR-003).

---

## 2. System overview

```
┌──────────── AI coding agents ────────────┐
│  Claude Code · Cursor · Copilot · Codex │
└───────────┬────────────────────┬────────┘
            │ AGENTS.md          │ MCP + hooks
            ▼                    ▼
┌─────────── Adapters (thin) ────────────┐
│ CLI · MCP · agent-hooks · git-hooks · CI
└───────────────┬────────────────────────┘
                │
                ▼
┌───────── Core library (all logic) ─────┐
│ Stack detect · Spec engine · Rule eng. │
│ Gate runner · Trace · Drift · Fix-loop │
│ Reporter (terminal/json/sarif/md)      │
└───────┬─────────────────┬──────────────┘
        │                 │
        ▼                 ▼
┌── External tools (wrapped) ──┐   ┌── On-disk state ──┐
│ gitleaks · eslint · ruff ·   │   │ .specgate/ +       │
│ vitest/jest/pytest/go test · │   │ repo files         │
│ dep-cruiser · osv-scanner    │   └────────────────────┘
└──────────────────────────────┘
```

**Lifecycle:**

```
Dev → specgate init                  (detected stack, installed rules + hooks)
Dev → specgate spec new (interview)  (requirements with REQ/AC ids + testable criteria)
Dev → specgate plan / tasks          (design.md, tasks.md)
     AGENTS.md + MCP tools exposed    (task-scoped rules fed to the agent)
Agent → get_task_context(T-003)
Agent → writes code + tests
Agent → check (via hook / MCP / CLI)
         ↓ findings + fix prompt
Agent → fixes (bounded retries)
Dev ← report: requirements covered, gates passed
```

See [run.md §4](../run.md#4-system-overview) for the full mermaid diagrams.

---

## 3. Components

The monorepo is pnpm-managed. All business logic lives in `packages/core`; adapters only translate I/O.

| Package                        | Role                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@specgate/core`               | Every decision function. 297 unit tests cover: stack detection, spec parse/validate, config load, gate runner, 7 individual gates (secrets · lint · tests · tamper · plus the gate interface), 3 reporters, fix-loop state + prompt builder, trace index + annotations + git-trailer parser, hooks installer, MCP tool business logic, uninstall, doctor + pinned-download installer. |
| `@specgate/cli`                | `specgate` / `sg` binary — commander-based CLI, 15 subcommands including a hidden `_commit-msg` for the hook shim.                                                                                                                                                                                                                                                                    |
| `@specgate/mcp`                | MCP stdio server exposing the 7 §9.2 tools + 3 resources. 2 integration tests spawn the server and exercise `tools/list` / `tools/call`.                                                                                                                                                                                                                                              |
| `@specgate/hooks`              | Thin reserved slot for standalone git-hook / Claude-Code-hook adapters. The actual logic lives in `core`.                                                                                                                                                                                                                                                                             |
| `@specgate/action`             | GitHub Action composite (`action.yml`) that installs the CLI, runs `check`, uploads SARIF, posts/updates a PR comment.                                                                                                                                                                                                                                                                |
| `@specgate/plugin-claude-code` | Claude Code plugin manifest + slash commands + hook fragment + MCP registration.                                                                                                                                                                                                                                                                                                      |
| `@specgate/distribution`       | Node SEA build script, Homebrew formula template, Scoop manifest template, `install.sh`, `install.ps1`, Dockerfile.                                                                                                                                                                                                                                                                   |

**Dependency rule (enforced by discipline, not tooling):** `cli`, `mcp`, `hooks`, `action` depend on `core`; `core` depends on none of them. `core` has no agent-specific code.

Build system: TypeScript strict mode + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` → `tsup` emits ESM (and CJS for the CLI shebang entry).

---

## 4. On-disk layout in your repo

After `specgate init`:

```
<your-repo>/
├── AGENTS.md                      # managed block injected (see §9.1)
├── CLAUDE.md                      # optional thin pointer to AGENTS.md
├── .specgate/
│   ├── config.yaml                # strictness, gates, packs, overrides
│   ├── stack.json                 # cached StackProfile
│   ├── rules/<pack>/pack.yaml     # installed rule packs (vendored, pinned)
│   ├── specs/
│   │   └── 001-feature-name/
│   │       ├── requirements.md
│   │       ├── design.md
│   │       ├── tasks.md
│   │       ├── tasks.meta.json
│   │       ├── ids.lock.json
│   │       └── proposals/NNN.md   # proposed changes (never auto-merged)
│   ├── hooks/
│   │   ├── pre-commit             # Node shim
│   │   └── commit-msg
│   ├── reports/                   # last N check results (gitignored)
│   ├── state.json                 # fix-loop counters (gitignored)
│   └── .gitignore                 # reports/ + state.json entries
├── .githooks/ or .husky/ or pre-commit config   # when a hook manager is already in use
└── .github/workflows/specgate.yml                # CI backstop
```

Rules: everything in `.specgate/` **except** `reports/` and `state.json` is committed. Generated blocks in shared files (AGENTS.md, husky's pre-commit, etc.) are wrapped in markers so user-written content is never overwritten:

```
<!-- specgate:begin -->
...managed content...
<!-- specgate:end -->
```

---

## 5. CLI reference

Binary: `specgate` (alias `sg`). Global flags: `--json`, `--quiet`, `--cwd <path>`, `--strictness <level>`.

### `init`

```bash
specgate init [--yes]
```

Detect stack, write `.specgate/config.yaml` (skipped if already present), inject AGENTS.md managed block, write `.specgate/.gitignore`. **Idempotent**: running twice produces byte-identical output.

### Spec engine

```bash
specgate spec new [name]           # 7-question interview → requirements.md (draft)
specgate spec validate <SPEC-id>   # structure, IDs, AC testability, immutability
specgate spec approve  <SPEC-id>   # flip status → approved, write ids.lock.json
specgate spec plan     <SPEC-id>   # scaffold design.md (requires approved)
specgate spec tasks    <SPEC-id>   # scaffold tasks.md, reject orphan AC links
specgate spec list                 # all specs with status
```

Error codes surfaced by `spec validate`:

- `E_DUP_ID` — duplicate REQ/AC/NFR id
- `E_EMPTY_AC` — AC body is whitespace
- `E_UNTESTABLE_AC` — AC has fewer than 5 words AND no Given/When/Then pattern
- `E_IMMUTABLE_REMOVAL` — approved id disappeared without `~~deprecated~~` marker
- `E_ORPHAN_TASK_LINK` — task's `implements:` references an AC not in the spec

### Gates + reporting

```bash
specgate check [--staged|--changed] [--gate <id>] [--fix-prompt] [--fail-on-warn]
specgate report --format sarif|md|json|terminal [--output <file>]
```

Exit codes per run.md §8:

- `0` — pass
- `1` — blocking failure
- `2` — tool/config error (e.g. a gate's binary crashed)
- `3` — warn-only + `--fail-on-warn`

`--fix-prompt` emits the §13.2 correction prompt on blocking failures, advances `.specgate/state.json`, resets on success. See §10.

### Traceability

```bash
specgate status [--json] [--untested-only] [--failing-only] [--orphans]
```

Shows the per-REQ → AC matrix with status badges (untested / passing / failing / done), test counts, task counts. `--orphans` filters to tests referencing AC ids that don't exist in any spec.

### Hooks

```bash
specgate hooks install       # git pre-commit + commit-msg shims
specgate hooks claude-code   # .claude/settings.json (merged, user hooks preserved)
```

If husky / pre-commit / lefthook is already present, SpecGate **integrates** via managed-block edits — it never clobbers.

### Doctor

```bash
specgate doctor                 # probe node/git/gitleaks + stack-specific tools
specgate doctor --install -y    # download pinned, SHA-256-verified binaries
                                # into ~/.specgate/bin (ADR-015)
```

### MCP server

```bash
specgate mcp                    # start stdio MCP server for the cwd
```

### Hidden

```bash
specgate _commit-msg <path>     # invoked by the commit-msg shim
```

### Uninstall

```bash
specgate uninstall [--yes]                # removes hooks + managed blocks (keeps specs)
specgate uninstall --yes --purge          # also deletes .specgate/
```

`--purge` is **byte-safe**: `diff -r` against the pre-`init` state is empty (verified by a dedicated test).

---

## 6. MCP tools + resources

`specgate mcp` starts a stdio server exposing:

### Tools

| Tool                  | Inputs                                              | What it does                                                                                              |
| --------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `get_active_spec`     | —                                                   | Returns the newest approved spec with its parsed requirements. Null when no specs exist.                  |
| `get_task_context`    | `task_id: T-xxx`, `max_tokens?: int`                | Task + ACs + relevant files + scored/budgeted rules. Over-budget rules reported in `budget.omittedRules`. |
| `list_tasks`          | `done?: bool`                                       | Tasks across every approved spec, with their `implements` + `tags`.                                       |
| `update_task`         | `task_id`, `done: bool`                             | Toggles the checkbox. `done=true` requires at least one test file to reference a linked AC.               |
| `check`               | `scope?: 'staged'\|'changed'\|'full'`, `gates?: []` | Runs `runCheck`; returns `GateResult[]` + a `fixPrompt` (text + payload) when blocking failures exist.    |
| `get_rule`            | `rule_id: string`                                   | Looks up a rule across installed packs. Returns null when absent.                                         |
| `propose_spec_change` | `spec_id`, `title`, `body`, `submitted_by?`         | Writes a `proposals/NNN.md`. **Never modifies the live spec.** Requires human approval.                   |

### Resources

| URI                     | MIME             | Content                                                   |
| ----------------------- | ---------------- | --------------------------------------------------------- |
| `specgate://status`     | application/json | Config + specs + task counts (from `getStatusResource`).  |
| `specgate://spec/{id}`  | text/markdown    | Raw `requirements.md` for the given spec id.              |
| `specgate://rules/{id}` | application/json | A rule across installed packs (same shape as `get_rule`). |

The MCP adapter is a thin shell over `packages/core/src/mcp/tools.ts` — every tool is a pure function tested without an MCP client (19 unit tests + 2 end-to-end stdio tests).

---

## 7. Config format

`.specgate/config.yaml` (run.md §7.2 is the source of truth):

```yaml
version: 1
strictness: standard # advisory | standard | strict
stack:
  override: {} # manual override of stack detection
packs:
  - name: clean-code-core
    version: 1.2.0
gates:
  secrets: { enabled: true, tool: gitleaks, blocking_at: standard }
  lint: { enabled: true, command: auto, blocking_at: standard }
  tests: { enabled: true, command: auto, blocking_at: standard }
  coverage: { enabled: true, changed_files_min: 70, blocking_at: strict }
  architecture: { enabled: true, blocking_at: strict }
  dependencies: { enabled: true, tool: osv-scanner, blocking_at: strict }
  spec: { enabled: true, require_spec_for_changes: true, blocking_at: strict }
fix_loop:
  max_attempts: 3
context:
  max_rule_tokens: 4000
telemetry: off
```

**Hard rules enforced by the zod schema:**

- `strictness` must be `advisory | standard | strict`.
- Any gate with `enabled: false` MUST declare a `reason` string (so disabling isn't silent).
- Unknown gates are rejected (strict `.object()`).
- Numeric ranges validated: `coverage.changed_files_min ∈ [0, 100]`, `fix_loop.max_attempts ∈ [1, 10]`, `context.max_rule_tokens ∈ [500, 100000]`.

Resolution order: `defaults ← preset ← user config ← CLI --strictness flag`.

---

## 8. Gates — how they work + how to extend them

### Gate interface

```ts
interface Gate {
  id: GateId; // "secrets" | "lint" | "tests" | "spec" | ...
  scopes: Array<'staged' | 'changed' | 'full'>;
  defaultBlockingAt: Strictness;
  detect(ctx: RepoContext): Promise<GateAvailability>; // tool present + applicable?
  run(ctx: RunContext): Promise<GateResult>;
}
```

`runGates` runs every registered gate in parallel with a per-gate timeout. A gate that throws becomes `status: 'error'`. A gate reporting `detect().available === false` becomes `status: 'skipped'` with the reason copied in. **A missing tool NEVER becomes `pass`** (run.md §10.3).

### Built-in gates (M3 + M5.C)

| id        | tool(s)                                     | scope          | default blocking |
| --------- | ------------------------------------------- | -------------- | ---------------- |
| `secrets` | gitleaks                                    | staged / full  | standard         |
| `lint`    | eslint / ruff / golangci-lint (auto-detect) | changed        | standard         |
| `tests`   | vitest / jest / pytest / go test            | changed / full | standard         |
| `spec`    | internal (tamper gate — ADR-013)            | all            | strict           |

Not yet shipped (post-MVP):

- `architecture` (dependency-cruiser · import-linter · ArchUnit · semgrep)
- `coverage` (runner coverage output + `changed_files_min` threshold)
- `dependencies` (osv-scanner · npm audit)

### Strictness resolution

A gate blocks iff `current_strictness >= gate.blocking_at`. The 3×3 truth table is covered in `test/gates/run.test.ts`.

### Subprocess safety (§22.7)

Every subprocess invocation goes through `packages/core/src/subprocess/run.ts`:

- **Argument arrays only.** The function signature prevents passing a shell string by construction.
- **Explicit binary resolution.** `resolveBinary(name)` walks `~/.specgate/bin` + PATH; Windows `.exe` / `.cmd` / `.bat` / `.com` fallbacks.
- **Per-call timeout** (default 60s).
- **1 MB per-stream buffer cap.**
- **Never throws** on non-zero exit — returns `{exitCode, stdout, stderr, timedOut, …}`.

### Secret redaction (§22.6)

`redact(text)` masks OpenAI / AWS / GitHub / Slack tokens + PEM private-key blocks. `redactLiteral(text, secret)` masks an exact match. The gitleaks normaliser passes every matched secret through `redactLiteral` so the raw value NEVER appears in output.

### Writing a new gate

1. Define a `Gate` object in `packages/core/src/gates/<id>.ts`.
2. Register it in `packages/core/src/check/run.ts` default list (or let callers pass it to `runGates`).
3. Ship a **recorded-output JSON** sample under `packages/core/test/fixtures/` so the normaliser test runs on CI without the real tool.
4. Add the gate id to `packages/core/src/schemas/config.ts` + regenerate `schemas/config.schema.json`.

---

## 9. Spec engine (requirements → tasks → traceability)

### Spec file layout

```markdown
---
id: SPEC-001
title: CSV export of reports
status: draft | approved | implemented
created: 2026-10-14
---

## Context

Plain-language problem statement.

## Requirements

### REQ-001: Users can export a report as CSV

- **AC-001.1**: Given a report with rows, when the user clicks Export, then a CSV file downloads with a header row.
- **AC-001.2**: Given a report with zero rows, then the CSV contains only the header.

## Non-functional

- NFR-001: Export of 100k rows completes in < 10s.

## Out of scope

- …
```

Rules:

- IDs are **unique, immutable** once approved. Removed items are marked `~~deprecated~~`, not deleted.
- Acceptance criteria use Given/When/Then or a single testable sentence (≥ 5 words).

### Phase gates

```
draft ─► (validate) ─► approved ─► (plan + tasks) ─► implemented
```

- **`spec approve`** refuses when `validate` reports any error. On success it writes `ids.lock.json` snapshotting every REQ/AC/NFR id so future renumbering is caught (`E_IMMUTABLE_REMOVAL`).
- **`spec plan`** scaffolds `design.md` (Overview / Decisions / Open Questions).
- **`spec tasks`** scaffolds `tasks.md` and rejects any `implements: AC-xxx.y` referencing an id that doesn't exist in the spec (`E_ORPHAN_TASK_LINK`).
- **`tasks.meta.json`** records `spec_sha256` (canonical-JSON hash of the parsed spec) so future drift detection (post-MVP) can flag stale tasks after the spec changed.

### Traceability

`buildTraceabilityIndex({cwd})` constructs:

```
REQ ─┬─ AC ─┬─ Task       (via tasks.md implements:)
     │      └─ Test       (annotation hits)
     └─ Commit            (via Spec: trailer in git log)
```

Annotation parsers recognise AC ids in test files for JS/TS, Python, Go — `@spec AC-xxx.y` in comments, `it("AC-xxx.y: ...")` test names, `@pytest.mark.spec(...)`, `func Test_AC_xxx_y_...`.

`isAcDone(graph, acId, {passingTests?, failingTests?})`:

1. Deprecated AC → `done`.
2. No tests linked → `untested`.
3. Any linked test in `failingTests` → `failing`.
4. `passingTests` supplied + not every linked test covered → `untested`.
5. Any linked task still unchecked → `passing`.
6. Otherwise → `done`.

`specgate status` renders this per-REQ, filterable with `--untested-only / --failing-only / --orphans`.

---

## 10. Fix-loop + tamper gate

### Fix-loop (M5)

`.specgate/state.json` tracks:

```ts
{
  spec_id?: string;
  task_id?: string;
  attempt: number;
  lastFindingsHash: string | null;
  updatedAt: string;
}
```

On every `check --fix-prompt`:

1. `hashBlockingFindings(results)` produces a deterministic sha256 over sorted `(file, line, id)`.
2. `shouldStop({state, maxAttempts, results})` returns one of:
   - `success` (zero blocking) — state reset.
   - `no-progress` (hash unchanged from last attempt) — stop.
   - `max-attempts` (counter >= cap) — stop.
   - Otherwise `stop: false`, state advances with the new hash.
3. `buildCorrectionPrompt(results, {attempt, maxAttempts, tokenBudget?})` emits:
   - **Text**: the §13.2 template with `[1] gate.rule_id — file:line`, `Problem:`, `Do:`, `Rule/Spec:` lines, grouped by file + severity, truncated to budget, with a final `(N additional findings omitted…)` note.
   - **Payload** (`CorrectionPayload` zod type): structured JSON for MCP consumption.

**Every prompt contains the forbid-list text verbatim** (§13.3): `Do not edit .specgate/config.yaml, baseline, or rule files to make this pass.` Regression-tested.

### Tamper gate (`spec` id, strict blocking, M5.C)

Watches edits to:

- `.specgate/config.yaml`
- `.specgate/baseline.json` (post-MVP)
- `packs/**`
- `.specgate/rules/**`

Behaviour (ADR-013):

- Local run → `status: warn` (non-blocking).
- CI + strict → `status: fail` (blocking) unless the PR has CODEOWNERS review or the `specgate-approved` label.

CI is detected via `CI` / `GITHUB_ACTIONS` / `GITLAB_CI` / `CIRCLECI` env vars. The finding message includes a 12-char SHA-256 of the current file for audit.

---

## 11. Hooks (git + Claude Code)

### Git hooks (M4.A)

`detectHookManager(cwd)` recognises husky / pre-commit / lefthook / none. Install policy:

- **Manager already present** → write a managed block inside its config (`.husky/pre-commit`, `.pre-commit-config.yaml`, `lefthook.yml`). User content around our block is preserved.
- **None** → set `git config core.hooksPath .specgate/hooks` and drop two Node shims:
  - `pre-commit` → `specgate check --staged`
  - `commit-msg` → `specgate _commit-msg <msgPath>`

Both shims **warn-and-skip** when `specgate` isn't on PATH (ADR-012: CI is the backstop, teammates without the tool must not be blocked).

### Commit-msg trailer validation

`validateCommitMessage({cwd, message, config})`:

- No active spec in the repo → always ok.
- `strictness: advisory` → never blocks; emits a `warn` verdict instead.
- `strictness >= standard` → blocks when the message lacks a `Spec: REQ-xxx` / `T-xxx` / `AC-xxx.y` trailer.

### Claude Code hooks (M4.D)

`writeClaudeCodeHooks(cwd)` writes / merges `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "specgate check --changed --gate secrets",
            "timeout": 20,
            "_specgateManaged": true
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "specgate check",
            "timeout": 180,
            "_specgateManaged": true
          }
        ]
      }
    ]
  }
}
```

**Merge-aware:** preserves user hooks around ours; the `_specgateManaged: true` tag lets subsequent calls replace only our entries without duplicating.

---

## 12. Reporters (terminal / JSON / SARIF / Markdown)

| Reporter  | Entry point            | Used by                                            |
| --------- | ---------------------- | -------------------------------------------------- |
| Terminal  | `renderTerminalReport` | `specgate check` (TTY-aware colors via picocolors) |
| JSON      | `renderJsonReport`     | `specgate check --json`, snapshot tests            |
| SARIF 2.1 | `renderSarifReport`    | GitHub Action — uploaded to code-scanning          |
| Markdown  | `renderMarkdownReport` | GitHub Action — posted as the PR comment           |

SARIF includes `partialFingerprints.specgate.finding.id` so GitHub de-duplicates between runs. The PR comment uses a stable `<!-- specgate-pr-comment -->` marker so re-runs **update** the existing comment instead of posting duplicates.

---

## 13. Rule packs

Two layers:

1. **Guidance** (prose) — fed to agents as context. Never claimed as enforced.
2. **Checks** (executable) — curated configs for dependency-cruiser / eslint-plugin-boundaries / import-linter / ArchUnit / semgrep. Reported as enforced.

Pack format (run.md §7.3):

```yaml
name: ts-node-layered
version: 0.3.1
license: MIT
source: original
applies_to:
  languages: [typescript]
  frameworks: [express, nestjs]
guidance:
  - id: LAYER-01
    title: Controllers must not access the database directly
    body: |
      Route handlers call services; services call repositories...
    scope: { globs: ['src/**/controllers/**'], tags: [backend] }
    severity: error
checks:
  - id: LAYER-01
    gate: architecture
    engine: dependency-cruiser
    config: checks/dependency-cruiser.cjs
    message: 'Controller imports a repository/DB module directly.'
    fix_hint: 'Move this logic into a service and call the service.'
```

Every pack **must** declare `license` + `source` (zod-enforced); unlicensed text is never bundled (ADR-009, run.md §11.4).

Rule selection in `getTaskContext` scores by `tagMatch(2) + globMatch(1)`, sorts, truncates to `context.max_rule_tokens`, and reports omissions.

First-party pack directories (`packs/`) are empty until P1 post-MVP (`ts-node-layered`, `fastapi-postgres`, `spring-boot-layered`, `generic-core`).

---

## 14. Development setup

### Prerequisites

- Node ≥ 20 (`node --version`)
- pnpm 9 (`npm i -g pnpm@9`)
- git (for the trace + trailer logic + tamper gate)
- (Optional) gitleaks for the real secrets gate; everything else is auto-detected per project.

### Clone + bootstrap

```bash
git clone https://github.com/abinashkm/The-Autonomous-Spec-Rule-Engine
cd specgate
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

### Development loop

```bash
pnpm -F @specgate/core test --watch         # core unit tests
pnpm -F @specgate/core test <path-substr>   # single file
pnpm format                                 # Prettier
pnpm lint                                   # ESLint flat config (incl. §22.7 subprocess rule)
pnpm typecheck                              # tsc --noEmit across packages
pnpm schemas                                # regenerate schemas/*.schema.json from zod
```

CI runs the full pipeline on Linux / macOS / Windows × Node 20. The schema-diff check fails the build if generated JSON Schemas drift from their zod sources.

### Working on the CLI

```bash
pnpm -F @specgate/core build
pnpm -F @specgate/cli build
node packages/cli/dist/index.js --help
# or for a fixture:
node packages/cli/dist/index.js --cwd fixtures/node-express-ts init --yes
```

### Working on MCP

```bash
pnpm -F @specgate/mcp build
node packages/mcp/dist/index.js    # stdio server; speak JSON-RPC 2.0 at it
```

The `test/server.test.ts` integration spawns the compiled binary + sends `initialize` + `tools/list` + `tools/call` — use it as a reference for your own client.

### Fixtures

- `fixtures/node-express-ts` — Express + TypeScript + vitest.
- `fixtures/python-fastapi` — FastAPI + pytest + ruff.
- `fixtures/empty-git-repo` — bare README; used for idempotency + `empty-indicator-stack` tests.

Every new gate / detector must ship a fixture case + golden output (run.md §22.9).

---

## 15. Testing strategy

| Layer                 | Scope                                                                                                                                       | Example                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Unit                  | Pure functions in `core` — parsers, schema parsers, hash + state, prompt builder                                                            | `test/fixloop/builder.test.ts`                         |
| Golden                | Rendered strings (AGENTS.md block, correction prompt text + payload, terminal/JSON/SARIF/Markdown reports) — snapshot files reviewed in PRs | `test/report/sarif.test.ts`                            |
| Integration (fixture) | Fixture repos with planted violations → run gates / init → assert exact findings                                                            | `test/init/run.test.ts`, `test/init/uninstall.test.ts` |
| Recorded-output       | Captured tool JSON (gitleaks, eslint, ruff, golangci, vitest, pytest) → normaliser tests → CI doesn't need every tool                       | `test/fixtures/gitleaks-sample.json`                   |
| End-to-end            | `init → spec new → approve → plan → tasks → check → status → uninstall --purge`; MCP stdio round-trip; `--fix-prompt` state advance         | `test/spec/m2.exit.test.ts`, `test/mcp/server.test.ts` |
| Cross-platform CI     | Linux / macOS / Windows × Node 20 on every push                                                                                             | `.github/workflows/ci.yml`                             |
| Dogfooding            | This repo uses SpecGate on itself from M3 onwards (`Spec:` trailers in commits)                                                             | `git log --grep="Spec:"`                               |

Current count: **297 core + 2 MCP = 299 tests** across 38 test files. Full pipeline (format / lint / typecheck / schemas-diff / build / test) is CI-enforced.

---

## 16. Release pipeline

Driven by `@changesets/cli` + `.github/workflows/release.yml`.

### Day-to-day: record a change

```bash
pnpm changeset                 # pick packages + bump type + summary → .changeset/<name>.md
git add .changeset/<name>.md
git commit -m "feat: short title"
```

### CI flow (automatic)

1. Push to `main` triggers `release.yml`.
2. If `.changeset/*.md` is present and not yet released, the workflow opens / updates a **"Version Packages"** PR. The PR bumps `package.json` versions, rewrites workspace deps to concrete semver, regenerates `CHANGELOG.md`, and deletes the consumed changesets.
3. When that PR is merged, the next run of the workflow **publishes to npm** with `provenance` (`NPM_CONFIG_PROVENANCE=true`).
4. Post-publish, each OS runner builds a Node SEA binary via `pnpm -F @specgate/distribution run sea:host`, uploads `dist/bin/*` + `checksums.txt` to the GitHub release.
5. A human (or a follow-up workflow) updates the Homebrew tap + Scoop bucket by substituting `__VERSION__` + checksums into the templates in `packages/distribution/manifests/`.

### Secrets required on the repo

- `NPM_TOKEN` — publish to npm (public + provenance).
- `GITHUB_TOKEN` — automatic; used for the Version-Packages PR + release uploads.

### First-time Marketplace step

For the GitHub Action, open the GitHub release page and check "Publish this release to the Marketplace". That is a one-time human action; subsequent `v1`/`v1.x` tags auto-update it.

---

## 17. Distribution channels

| Channel                      | Audience                      | Setup for publisher                                                                                          |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| npm (`@specgate/*`)          | JS/TS devs                    | `release.yml` publishes with provenance.                                                                     |
| Standalone binaries          | Non-Node devs (Python, Go, …) | SEA built per OS in CI; checksums.txt attached to the release.                                               |
| Homebrew tap                 | macOS/Linux CLI users         | Separate `homebrew-specgate` repo; manifest substituted from `manifests/homebrew/*.tmpl`.                    |
| Scoop bucket                 | Windows CLI users             | Separate `scoop-bucket` repo; manifest substituted from `manifests/scoop/*.tmpl`.                            |
| `install.sh` + `install.ps1` | curl / iwr one-liner          | Hosted at `raw.githubusercontent.com/abinashkm/The-Autonomous-Spec-Rule-Engine/main/packages/distribution/`. |
| GitHub Action                | Any GitHub repo               | `packages/action/action.yml` + Marketplace publish on first release.                                         |
| Docker image                 | CI / devcontainers            | `packages/distribution/Dockerfile` ships CLI + pinned gitleaks.                                              |
| Claude Code plugin           | Claude Code users             | `packages/plugin-claude-code/` is loaded as a plugin dir.                                                    |
| MCP server listing           | Any MCP-capable agent         | `specgate mcp` over stdio.                                                                                   |
| PyPI shim (post-MVP)         | Python shops                  | `pipx install specgate` downloads the standalone binary.                                                     |
| VS Code extension (post-MVP) | Visual users                  | Thin client over `--json` output.                                                                            |

See [run.md §24](../run.md#24-distribution--installation) for the adoption-ladder narrative.

---

## 18. Security + privacy

- **Local-first.** No network calls in core flows. `doctor --install` + pack updates are the only outbound calls, both user-triggered.
- **Telemetry off by default.** If ever added, opt-in, documented, content-free.
- **Secrets in reports.** gitleaks findings are redacted in all outputs (rule + file + line, never the secret).
- **Subprocess safety.** Argument arrays only, no shell interpolation, explicit binary paths, size + time caps. Enforced by an ESLint `no-restricted-imports` + `no-restricted-syntax` rule set.
- **Rule-pack trust.** Third-party packs may ship executable configs/commands; the installer prompts for confirmation and pins versions + hashes. Prompt-injection flags on untrusted pack content are best-effort advisory.
- **Config tamper.** `tamper` gate (ADR-013) warns locally + blocks at CI+strict on edits to `.specgate/config.yaml`, `.specgate/baseline.json`, `packs/**`, `.specgate/rules/**` without CODEOWNERS review.
- **MCP tools cannot execute arbitrary commands.** `check` only runs the configured gates. Non-destructive by design.

---

## 19. Troubleshooting

### Gates always `skipped: gitleaks not found`

Install gitleaks (recommended): `specgate doctor --install -y`. Alternatively `brew install gitleaks` / `scoop install gitleaks` / download from the releases page.

### Hook ran but printed nothing

ADR-012: shims warn-and-skip when `specgate` isn't on PATH. Check `which specgate` (POSIX) / `where specgate` (Windows). If missing, re-run the installer.

### CI blocked but local pass

That's by design. The non-bypassable backstop. Common cause: tamper gate flagged a config edit, local didn't block (ADR-013). Get CODEOWNERS approval or apply the `specgate-approved` label.

### `specgate check --fix-prompt` loops forever

It doesn't. Either `max-attempts` (default 3) or `no-progress` (identical findings two runs in a row) stops it. Reset manually with `rm .specgate/state.json`.

### "spec is still a draft" when I try to plan / tasks

`spec plan` + `spec tasks` require `status: approved`. Run `spec validate <id>` → fix errors → `spec approve <id>`.

### "E_IMMUTABLE_REMOVAL AC-xxx.y"

An approved AC id disappeared from the file. Either put it back, mark it `~~deprecated~~` (keep the id, strike the text), or run `rm .specgate/specs/<dir>/ids.lock.json` + re-approve (last resort — loses the historical freeze).

### Managed block duplicated in AGENTS.md

Shouldn't happen since M1.C.2 — the writer matches markers only when alone on a line. If you see duplication, open an issue with the surrounding file content.

### CI runner complains "pnpm not found"

The workflow uses `pnpm/action-setup@v4` → `actions/setup-node@v4` with `cache: pnpm`. Make sure both exist in the workflow, in that order.

More: [when-a-check-fails.md](when-a-check-fails.md).

---

## 20. Roadmap + post-MVP

Current state: MVP (M0 – M8) complete. 299 passing tests. Awaiting pilot (5–10 real repos).

Pilot kill/pivot rule ([run.md §21.4](../run.md#214-success-metrics-and-kill-criteria-initial-targets-adjust-after-pilots)): if fewer than 3 of 10 pilot repos keep SpecGate enabled after 2 weeks, pivot to **CI-Action-only verifier** positioning or stop. Do NOT start post-MVP work before this bar clears.

Post-MVP backlog (ordered by likely value; subject to pilot feedback):

1. **Architecture gate + first two enforcement packs** (ts-node-layered, fastapi-postgres).
2. **Brownfield `scan` + baseline + change deltas** (OpenSpec-inspired ADDED/MODIFIED/REMOVED delta flow).
3. **Drift detector** (route / export / stale-task extractors for Express, NestJS, FastAPI, Next.js).
4. **Dependency audit + coverage gates** (osv-scanner, changed-files-min coverage threshold).
5. **Local dashboard** (`specgate ui` serves a read-only web page from `status --json`) + **VS Code extension**.
6. **Community packs** + semgrep integration.
7. **GitLab CI + other CI adapters.**

See [PLAN.md "Post-MVP backlog"](../PLAN.md) for the fully-decomposed task list.

---

## Appendix A — Related docs

- **[run.md](../run.md)** — authoritative design doc (ADRs, data formats, module boundaries, risks, roadmap). Humans + AI agents working on this repo read this before writing code.
- **[PLAN.md](../PLAN.md)** — the micro-managed delivery plan with every task's DoD + exit-check summaries per milestone.
- **[quickstart.md](quickstart.md)** — the 5-minute walkthrough.
- **[when-a-check-fails.md](when-a-check-fails.md)** — per-gate recovery guide.
- **[../packages/plugin-claude-code/README.md](../packages/plugin-claude-code/README.md)** — Claude Code plugin specifics.
- **[../packages/action/action.yml](../packages/action/action.yml)** — GitHub Action composite + input/output reference.
- **[../THIRD_PARTY.md](../THIRD_PARTY.md)** — third-party content provenance.
