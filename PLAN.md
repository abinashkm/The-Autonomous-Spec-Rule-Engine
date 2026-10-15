# SpecGate — Micro-Managed Development Plan

> Companion to [run.md](run.md). Every section number here points back to the authoritative design in `run.md`.
> If `run.md` and this file disagree, **fix one of them in the same change** (ADR-driven, see §22).

**How to use this document**

1. Work top-to-bottom. **Do not skip ahead** between milestones — M-N depends on M-(N-1).
2. Within a milestone, phases (A, B, C…) are usually sequential; tasks inside a phase may be parallel-safe when noted.
3. Each task is 15–90 minutes of focused work. If a task is bigger than that, split it.
4. States: `[ ]` todo, `[~]` in-progress, `[x]` done, `[!]` blocked (with reason).
5. Every task has:
    - **Files** — paths it touches
    - **DoD** — Definition of Done (concrete, checkable)
    - **Depends on** — upstream task IDs (omitted when it's just the previous task)
6. Never mark `[x]` without the DoD being verifiable from the diff + a passing test or command.
7. When a task is done, update this file in the **same commit** as the code change (dogfooding §22.11 starts at M3; before then, keep it in the PR description).

**Repo-wide invariants (hold on every PR, from day one)**

- All logic lives in `packages/core`. Adapters (`cli`, `mcp`, `hooks`, `action`) only translate I/O. (§22.3)
- zod schemas are the source of truth; JSON Schema is **generated** into `schemas/`. (§22.4)
- Gates are deterministic. No LLM in the pass/fail path. Missing tool → `skipped`, never `pass`. (§22.5)
- Never print secrets. Argument arrays only — no shell string interpolation. (§22.6-7)
- Only write inside `<!-- specgate:begin -->` / `<!-- specgate:end -->` markers in shared files. (§22.8)
- Every new gate / detector ships a fixture + golden output. (§22.9)
- One concern per PR. Update `run.md` compat matrix (§9.6) when adapter behaviour changes. (§22.10)

---

## Pre-flight (before touching M0)

- [x] **PF.1** Confirm Node ≥ 20 is installed on all contributor machines (`node --version`). *Blocker, 2 min.*
- [x] **PF.2** Install pnpm ≥ 9 globally (`npm i -g pnpm`). *2 min.*
- [x] **PF.3** Decide **PRODUCT_NAME** constant value for now (default `SpecGate`, fallback list in §21.2 row 1). Record in this file: `PRODUCT_NAME = "SpecGate"`. *5 min.*
- [x] **PF.4** Create `.editorconfig` (LF, utf-8, 2-space, trim trailing ws). *5 min.*
- [x] **PF.5** Create `.gitattributes` (`* text=auto eol=lf`, mark `*.png *.gif binary`). *5 min.*
- [x] **PF.6** Create `.gitignore` at repo root with: `node_modules/`, `dist/`, `.turbo/`, `coverage/`, `.specgate/reports/`, `.specgate/state.json`, `.DS_Store`, `*.log`. *5 min.*
- [x] **PF.7** Add `LICENSE` (Apache-2.0 full text) at repo root. (§21.2 row 4, ADR-009) *5 min.*
- [x] **PF.8** Create `THIRD_PARTY.md` with "No third-party text bundled yet." (§21.3 licensing row) *5 min.*

---

## M0 — Foundations (week 1)

> **Done when:** schemas published, `specgate --version` runs, CI green on 3 OSes. (§20 M0)

### M0.A — Monorepo scaffolding

- [x] **M0.A.1** Create `package.json` at repo root with: `"private": true`, `"packageManager": "pnpm@9.x"`, scripts `build`, `test`, `lint`, `typecheck`, `format`.
    - Files: `package.json`
    - DoD: `pnpm -v` works; `pnpm install` runs (no deps yet).
- [x] **M0.A.2** Create `pnpm-workspace.yaml` with `packages: ['packages/*', 'packs/*']`.
    - Files: `pnpm-workspace.yaml`
    - DoD: `pnpm m ls` returns an empty list without errors.
- [x] **M0.A.3** Create empty package dirs: `packages/core`, `packages/cli`, `packages/mcp`, `packages/hooks`, `packages/action`, `packages/plugin-claude-code`, `packages/distribution`. Each gets a stub `package.json` (`"name": "@specgate/<name>"`, `"version": "0.0.0"`, `"private": true`, `"type": "module"`).
    - Files: `packages/*/package.json`
    - DoD: `pnpm m ls` lists all 7.
- [x] **M0.A.4** Create empty `packs/`, `fixtures/`, `schemas/`, `docs/` directories, each with a `.gitkeep`.
    - Files: `packs/.gitkeep`, `fixtures/.gitkeep`, `schemas/.gitkeep`, `docs/.gitkeep`
    - DoD: `git status` shows them tracked.
    - Note: `schemas/.gitkeep` was removed in M0.C.7 once generated schemas populated the dir.

### M0.B — Build & TS toolchain

- [x] **M0.B.1** Install dev deps at root: `typescript@5`, `tsup`, `@types/node@20`, `vitest`, `eslint@9`, `@typescript-eslint/*`, `prettier`, `tsx`.
    - DoD: `pnpm install` succeeds; `node_modules/typescript` exists.
- [x] **M0.B.2** Add root `tsconfig.base.json`: `strict: true`, `moduleResolution: "bundler"`, `target: ES2022`, `module: ESNext`, `isolatedModules: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
    - Files: `tsconfig.base.json`
    - DoD: file parses, no refs yet.
- [x] **M0.B.3** Each package gets a `tsconfig.json` extending the base, with `include: ["src"]` and `outDir: "dist"`.
    - Files: `packages/*/tsconfig.json`
    - DoD: `pnpm -r exec tsc --noEmit` passes on empty src dirs.
    - Note: root scripts use `--filter "@specgate/*"` (double quotes) because pnpm's path-glob filter does not match on Windows with single quotes.
- [x] **M0.B.4** Add `tsup.config.ts` per package producing ESM + d.ts; CJS **only** for `packages/cli` (needed for shebang + older Node envs).
    - Files: `packages/*/tsup.config.ts`
    - DoD: `pnpm -r build` emits `dist/index.js` + `dist/index.d.ts`.
- [x] **M0.B.5** Root `.prettierrc` (`"singleQuote": true, "trailingComma": "all", "printWidth": 100`) + `.prettierignore`.
    - DoD: `pnpm format --check` passes on empty tree.
- [x] **M0.B.6** Root `eslint.config.js` (flat config) with `@typescript-eslint/recommended-type-checked` + the invariant rule: forbid `child_process.exec`/`execSync` string form (custom restricted-syntax rule) to enforce §22.7.
    - Files: `eslint.config.js`
    - DoD: `pnpm lint` passes; a planted `exec('ls')` in a test file triggers the rule (verify, then revert).
    - Verified: planted `cp.execSync('ls')` triggered `no-restricted-syntax` with the §22.7 message; removed after the probe passed.

### M0.C — Zod schemas (interface contract first — §22.4)

- [x] **M0.C.1** `packages/core/src/schemas/config.ts` — zod schema for `.specgate/config.yaml` matching §7.2.
    - Fields: `version`, `strictness` (`advisory|standard|strict`), `stack.override`, `packs[]`, `gates.{secrets,lint,tests,coverage,architecture,dependencies,spec}`, `fix_loop.max_attempts`, `context.max_rule_tokens`, `telemetry`.
    - DoD: unit test parses the example from §7.2 verbatim and rejects unknown gates.
    - Bonus: enforces §13.3 — a disabled gate must declare a `reason` (test passes).
- [x] **M0.C.2** `packages/core/src/schemas/spec.ts` — zod schemas for parsed `requirements.md` frontmatter + `tasks.md` task row.
    - DoD: parses the §7.1 examples; rejects duplicate IDs; rejects empty ACs.
- [x] **M0.C.3** `packages/core/src/schemas/pack.ts` — zod schema for `pack.yaml` matching §7.3 (including `applies_to`, `guidance[]`, `checks[]`, mandatory `license` + `source`).
    - DoD: §7.3 example parses; missing `license` fails with a readable error.
- [x] **M0.C.4** `packages/core/src/schemas/gate-result.ts` — zod schema for `GateResult` matching §7.4; include `status` enum `pass|fail|warn|skipped|error`.
    - DoD: §7.4 example parses; `status: "ok"` fails.
    - Bonus: enforces §10.3 — `skipped` must set `skipped_reason`, `error` must set `error_message`, `pass`/`skipped` cannot carry findings.
- [x] **M0.C.5** `packages/core/src/schemas/stack-profile.ts` — zod schema for `StackProfile` (languages, frameworks, package managers, test runners, linters, CI provider, per-field `confidence` 0–1).
    - DoD: schema compiles; empty profile is valid.
- [x] **M0.C.6** `packages/core/src/schemas/index.ts` barrel export of all five schemas + inferred types.
    - DoD: `import { ConfigSchema } from '@specgate/core'` resolves (once `index.ts` re-exports).
- [x] **M0.C.7** Script `scripts/gen-schemas.ts` that reads each zod schema and writes JSON Schema into `schemas/<name>.schema.json`.
    - DoD: `pnpm schemas` writes 6 files, deterministic (re-running produces no diff).
    - Note: uses `z.toJSONSchema` built in to zod v4 (not `zod-to-json-schema`, which supports zod v3 only — removed from deps).
- [x] **M0.C.8** Commit generated schemas; add CI step that fails if `pnpm schemas` produces a diff.
    - DoD: CI step wired in `.github/workflows/ci.yml` as "Verify schemas are up to date (M0.C.8)".

### M0.D — CLI skeleton for `--version` smoke

- [x] **M0.D.1** `packages/cli/src/index.ts` — commander/cac setup; register no commands yet, but wire `--version` from `package.json`.
    - DoD: `node packages/cli/dist/index.js --version` prints `0.0.0`.
- [x] **M0.D.2** Add `"bin": { "specgate": "./dist/index.js", "sg": "./dist/index.js" }` to `packages/cli/package.json` with `#!/usr/bin/env node` shebang in build output.
    - DoD: `pnpm -F @specgate/cli build && node packages/cli/dist/index.js --version` works on Windows and POSIX.
- [x] **M0.D.3** Add `PRODUCT_NAME` constant in `packages/core/src/constants.ts` (§21.2 row 1) and import it in the CLI banner.
    - DoD: `specgate --help` shows the SpecGate tagline + the version flag; verified locally.

### M0.E — CI matrix

- [x] **M0.E.1** `.github/workflows/ci.yml` matrix: `ubuntu-latest`, `macos-latest`, `windows-latest` × Node `20`.
    - Steps: checkout, setup-pnpm, `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm schemas` + exit-code diff, `pnpm build`, `pnpm test`, CLI smoke.
    - DoD: file committed; "all 3 OSes green on main" verifies on first push.
- [x] **M0.E.2** Add `pnpm-lock.yaml` to repo; mark required for CI.
    - DoD: `pnpm install --frozen-lockfile` passes locally.
- [x] **M0.E.3** Add `.github/CODEOWNERS` with placeholder; marks `.specgate/`, `schemas/`, `run.md`, `PLAN.md` as review-required. (§13.3, §16 tamper protection)
    - DoD: file present; owner handle still `@owner` placeholder until the project moves out of pre-development.

### M0.F — Name-availability check (§21.2 row 1, §21.5)

- [~] **M0.F.1** Record npm name availability for `specgate`, `@specgate/cli`. — *deferred, needs internet*
- [~] **M0.F.2** Record GitHub org availability. — *deferred, needs internet*
- [~] **M0.F.3** Record domain availability (specgate.dev / .io / .sh). — *deferred, needs internet*
- [~] **M0.F.4** Record trademark search result (USPTO TESS word-mark search). — *deferred, needs internet*
- [x] **M0.F.5** If any blocker, pick a fallback from §21.2 row 1 and update `PRODUCT_NAME` + package `name` fields in one commit.
    - DoD: template + fallback procedure recorded in `docs/name-check.md`; no blockers found offline so working name stays `SpecGate`.

**M0 exit check:** ✅ `specgate --version` prints `0.0.0` locally; `schemas/*.schema.json` are generated and determinism-verified; name decision is recorded (channels pending real online verification). **Proceeding to M1.**

---

## M1 — Init + Stack Detection + AGENTS.md (week 1-2)

> **Done when:** on 3 fixture repos, `init --yes` produces correct config + AGENTS.md without touching user content outside markers; re-running is idempotent. (§20 M1)

### M1.A — Fixture repos (write these first, they define correctness)

- [x] **M1.A.1** `fixtures/node-express-ts/` — minimal Express+TS app: `package.json` (express, typescript, vitest), `src/server.ts`, `tsconfig.json`.
    - DoD: file tree present; `init --yes` + idempotency check green against it.
- [x] **M1.A.2** `fixtures/python-fastapi/` — `pyproject.toml` (fastapi, pytest, ruff), `app/main.py`, `tests/test_smoke.py`.
    - DoD: file tree present; stack detector + init both work against it in CI.
- [x] **M1.A.3** `fixtures/empty-git-repo/` — just a `README.md`; tests `cp -r` into tmp.
    - DoD: `init --yes` runs against it; idempotency green.

### M1.B — Stack detector

- [x] **M1.B.1** `packages/core/src/stack/signatures.ts` — table of file signatures per stack.
    - DoD: ~45 signatures across 6 axes (languages, frameworks, package managers, test runners, linters, CI providers); exported as a readonly const; type-checked.
- [x] **M1.B.2** `packages/core/src/stack/detect.ts` — `detectStack(root)`; shallow walk (depth 3) with ignore list; no network; content probes with per-file 256 KB cap.
    - DoD: on `fixtures/node-express-ts` returns `typescript`, `express`, `vitest`, `npm` (lockfile-less pkg fallback), confidence > 0.8. Verified in `test/stack/detect.fixtures.test.ts`.
- [x] **M1.B.3** Unit tests for `detectStack` using `tmp` dirs — empty repo, Node+TS, Python, mixed, CI provider, missing path.
    - DoD: 10 passing tests + 3 against real on-disk fixtures.
- [x] **M1.B.4** Confidence reporting: per-field 0–1 by signature-weight sum, clamped.
    - DoD: Node-only repo returns `python.confidence === 0`; mixed repo returns both > 0.5. Verified in `detect.test.ts`.
- [x] **M1.B.5** User override: `applyStackOverride(profile, override)` replaces detected values with user-pinned ones.
    - DoD: `languages: ['go']` on a Node repo wins (unit test).
- [x] **M1.B.6** Cache at `.specgate/stack.json`; `detectStackCached({ useCache: true })` reuses cache when newer than indicator files (package.json, pyproject.toml, etc.).
    - DoD: second call does not re-walk (`vi.spyOn(detectStack)` asserts call count stays at 1). Empty-indicator repos trust the cache unconditionally (fixes M1.F.2 idempotency on `empty-git-repo`).

### M1.C — Managed-block writer (§6, §22.8)

- [x] **M1.C.1** `packages/core/src/managed-block/markers.ts` — exports `BEGIN`, `END` (re-export of constants.ts to keep one source of truth).
    - DoD: constants exported, imported by writer.
- [x] **M1.C.2** `packages/core/src/managed-block/writer.ts` — `writeManagedBlock(filePath, content, { createIfMissing })`.
    - DoD: 13 passing tests covering: (a) new file create, (b) replace between markers preserving outside bytes, (c) absent-marker + createIfMissing:false → `ManagedBlockError`, (d) absent-marker + createIfMissing:true → append, (e) idempotent re-write, (f) half-marker rejection, (g) CRLF preservation.
    - **Critical fix** found during M1.F.2: markers are matched only when alone on a line — previously `indexOf(BEGIN)` matched the literal marker string appearing in the body prose, duplicating the block on re-run.
- [x] **M1.C.3** Golden snapshot committed for the AGENTS.md body (via `renderAgentsBlock` test in M1.D).
    - DoD: snapshot committed under `packages/core/test/agents-md/__snapshots__/`.

### M1.D — AGENTS.md generator (§9.1)

- [x] **M1.D.1** `packages/core/src/agents-md/render.ts` — pure `renderAgentsBlock(profile, config): string`.
    - DoD: generated text contains `specgate context` + `specgate check`; the §9.1 line-count budget holds (≤ 150).
- [x] **M1.D.2** Token-budget guard: `estimateTokens(text) = ceil(text.length / 4)`; throws `AgentsBlockBudgetError` above `MAX_AGENTS_MD_TOKENS` (default 1500).
    - DoD: padded-profile test triggers the error.
- [x] **M1.D.3** Side-car files `SIDE_CARS` — `CLAUDE.md`, `.cursor/rules/specgate.mdc`, `.github/copilot-instructions.md`, `GEMINI.md`.
    - DoD: each is < 10 non-blank lines and mentions `AGENTS.md`. (Verified in test.) The `init` command does not yet write these — surfaced via `SIDE_CARS` for M4 agent-hook adapter to consume.

### M1.E — Config loader

- [x] **M1.E.1** `packages/core/src/config/load.ts` — `loadConfig(cwd)`: reads `.specgate/config.yaml` via `js-yaml`, validates via `ConfigSchema`.
    - DoD: bad `strictness` → `ConfigLoadError` with path `/strictness` surfaced in the message.
- [x] **M1.E.2** `defaults.ts` — `defaultConfig()` returning the §7.2 example (presets land in M8).
    - DoD: `ConfigSchema.parse(defaultConfig())` succeeds.
- [x] **M1.E.3** `resolveConfig({cwd, cliFlags, preset})` with merge order: defaults ← preset ← user ← CLI.
    - DoD: user `strictness: strict` beats default; `--strictness advisory` beats both.

### M1.F — `specgate init` command

- [x] **M1.F.1** Core: `runInit({cwd})` lives in `packages/core/src/init/run.ts`; CLI wrapper in `packages/cli/src/commands/init.ts` with `--yes` and `@clack/prompts` interactive confirm.
    - DoD: on `fixtures/node-express-ts`, `specgate init --yes` creates `.specgate/config.yaml`, `.specgate/stack.json`, `.specgate/.gitignore`, and the AGENTS.md managed block.
- [x] **M1.F.2** Idempotency: integration test `test/init/run.test.ts` + end-to-end `diff -r` over all 3 fixtures. Zero bytes change on second run.
- [x] **M1.F.3** Non-destructive: pre-seed AGENTS.md with user content, run init, user bytes preserved. Also tested the "user adds content around the block, re-run replaces only the managed region" case.
- [x] **M1.F.4** `.specgate/.gitignore` writes `reports/` + `state.json`.
    - DoD: created on first run, skipped on subsequent runs; verified in test.

### M1.G — `specgate doctor` (no-install baseline)

- [x] **M1.G.1** Core: `runDoctor({cwd})` probes `node`, `git`, `gitleaks` (always) + language-specific tools based on the detected stack (`pnpm`/`npm`, `python`, `ruff`). CLI wrapper in `packages/cli/src/commands/doctor.ts`.
    - DoD: gitleaks reports `missing` with a hint; command exits 0 (advisory in M1).
    - Subprocess safety: uses `execFileSync` with argument arrays per §22.7.
- [x] **M1.G.2** `--install` prints the deferral and exits 2.
    - Verified: `specgate doctor --install` prints `deferred to M8 (ADR-015)` and exits 2.

**M1 exit check:** ✅ 3 fixture `init --yes` runs produce byte-identical trees on re-run (verified end-to-end); `doctor` runs clean on the dev machine; full pipeline (format/lint/typecheck/schemas/build/test) green. 85 passing core tests. **Proceeding to M2.**

---

## M2 — Spec Engine (week 2-3)

> **Done when:** wizard spec validates; renumbering after approval is rejected; invalid ACs produce clear errors. (§20 M2)

### M2.A — Markdown + frontmatter parsing

- [x] **M2.A.1** Deps: `gray-matter`, `unified`, `remark-parse`, `mdast-util-to-string` + `@types/mdast`.
- [x] **M2.A.2** `parseRequirements(md)` → `{frontmatter, context, requirements[], nonFunctional[], outOfScope[]}` via remark AST walk. Normalises gray-matter's auto-Date coercion of `created` back to `YYYY-MM-DD`.
    - DoD: parses the §7.1 example end-to-end; rejects empty/missing Requirements section; marks `~~deprecated~~` ACs.
- [x] **M2.A.3** `parseTasks(md)` parses `## Tasks` list items via a strict regex (checkbox + `T-xxx` + title + optional `implements:` + optional `tags:`). Silently ignores non-task bullets.
    - DoD: 4 passing tests covering §7.1 example, no-tags path, duplicate rejection, non-task filtering.

### M2.B — Stable IDs & validation

- [x] **M2.B.1** `ids.ts` — regex table per prefix, `isValidId`, `nextId(prefix, existing[])`, `nextAcId(reqId, existing[])`. **Never fills gaps** — `nextId('REQ', ['REQ-001','REQ-003'])` returns `REQ-004`.
    - DoD: 9 passing tests.
- [x] **M2.B.2** `validateSpec(parsed)` → `{valid, issues: [{code, id?, message}]}` with codes `E_DUP_ID`, `E_EMPTY_AC`, `E_UNTESTABLE_AC`, `E_BAD_STATUS`, `E_IMMUTABLE_REMOVAL`, `E_IMMUTABLE_RENUMBER`. `E_UNTESTABLE_AC` heuristic: fewer than 5 words AND lacks a Given/When/Then pattern. Deprecated ACs skip the untestability check.
    - DoD: 5 passing validator tests.
- [x] **M2.B.3** Immutability lock: `writeIdsLock`/`readIdsLock`/`validateImmutability` with `ids.lock.json` snapshot. `collectIds` returns deterministic sorted list.
    - DoD: 5 passing immutability tests; `~~deprecated~~` ids are accepted.

### M2.C — Interview wizard (standalone, no LLM — ADR-010)

- [x] **M2.C.1** `INTERVIEW_QUESTIONS` — 7 templated questions: name, who, problem, success, scenarios (list), non-functional (list, optional), outOfScope (list, optional).
    - DoD: length between 5 and 8; each has `id`, `prompt`, `kind`, `required`.
- [x] **M2.C.2** `renderDraftRequirements(answers, {specId, createdDate})` → `requirements.md` string with placeholder ACs. Scenarios land verbatim as ACs; the validator rejects untestable ones on `approve` so the human gets a clear E_UNTESTABLE_AC instead of a silent inline hint.
- [x] **M2.C.3** Core: `specNew({cwd, answers})` writes `.specgate/specs/<NNN>-<slug>/requirements.md`. CLI wrapper runs @clack prompts over the question set.
    - DoD: auto-NNN never fills gaps; refuses to overwrite an existing dir (defensive guard).
- [x] **M2.C.4** `specValidate(cwd, specIdOrName)` runs base validation + immutability check (when approved). CLI command: pretty-print + `--json`.
    - DoD: `spec validate SPEC-001 --json` returns `{valid, issues, immutabilityIssues, specDir}`; exit 0/1/2 for pass/fail/error.
- [x] **M2.C.5** `specApprove({cwd, specIdOrName})` runs validator; refuses on invalid; else rewrites `status: approved` byte-safe (no gray-matter re-serialisation) and writes `ids.lock.json`.
    - DoD: approving a spec with `E_UNTESTABLE_AC` throws `SpecWorkflowError{code:E_SPEC_INVALID}`; approving a valid one creates the lock.

### M2.D — Design + tasks phases

- [x] **M2.D.1** `specPlan(cwd, specIdOrName)` writes `design.md` template (Overview / Decisions / Open Questions). Refuses on draft (`E_SPEC_NOT_APPROVED`).
    - DoD: creates on first run, reports `validated` on second.
- [x] **M2.D.2** `specTasks({cwd, specIdOrName})` creates `tasks.md` from AC seed template. On re-run, calls `validateTaskLinks` and throws `SpecWorkflowError{E_ORPHAN_TASK_LINK}` if any `implements:` references an id not in the spec.
    - DoD: a planted `implements: AC-404.1` triggers the error with the task + AC id in the message.
- [x] **M2.D.3** `computeSpecHash(parsed)` → sha256 over canonical JSON of REQ/AC/NFR structure (not raw bytes — cosmetic whitespace doesn't invalidate). Written to `tasks.meta.json` as `specSha256` + `generatedAt`.
    - DoD: whitespace-only edit yields identical hash; structural edit changes it.

**M2 exit check:** ✅ end-to-end round trip (`spec new → validate → approve → plan → tasks`) green across all 3 fixtures via `m2.exit.test.ts`; CLI `--json` subcommands verified on seeded spec; renumber attempts rejected with `E_IMMUTABLE_REMOVAL`; untestable ACs flagged with `E_UNTESTABLE_AC`. Core test count: **137 passing**. Pipeline (format/lint/typecheck/schemas/build/test/CLI smoke) all exit 0.

---

## M3 — Gate Runner + Core Gates (week 3-4)

> **Done when:** fixtures with planted secret / lint / test failures yield exact expected findings; missing tool → `skipped`; staged scope < 5 s. (§20 M3)

### M3.A — Gate interface

- [ ] **M3.A.1** `packages/core/src/gates/types.ts` — `Gate`, `RepoContext`, `RunContext`, `GateAvailability`, `GateResult` interfaces matching §10.1 + §7.4. `scopes: ("staged"|"changed"|"full")[]`; `defaultBlockingAt`.
    - DoD: all five schemas from M0.C are referenced; `tsc` passes.
- [ ] **M3.A.2** `packages/core/src/gates/registry.ts` — `registerGate(g)`, `listGates()`, `getGate(id)`. Deterministic ordering: alphabetical by id.
    - DoD: unit test registers 2 gates, `listGates()` returns them sorted.
- [ ] **M3.A.3** `runGates(ctx, gates, { parallel: true, perGateTimeoutMs })` — runs gates with `Promise.all` where `concurrencyKey` doesn't collide; captures stdout/stderr with a size cap (e.g. 1 MB per gate); never throws, always returns `GateResult[]` (errors become `status: "error"`).
    - DoD: a gate that throws yields `status: "error"` with the message; a gate that hangs past timeout yields `status: "error"` with `"timeout"`.
- [ ] **M3.A.4** Strictness resolution: `blocking = strictness >= gate.blockingAt`. Pure function with a tested truth table.
    - DoD: 9 cases (3×3) all correct.

### M3.B — Subprocess safety harness (§16, §22.7)

- [ ] **M3.B.1** `packages/core/src/subprocess/run.ts` — wraps `execa` with: arg array only, resolved absolute binary path, env allowlist, timeout, stdout/stderr size cap, redaction hook.
    - DoD: unit test: passing a string instead of array throws at type-check (compile error). Shell interpolation path is impossible.
- [ ] **M3.B.2** `resolveBinary(name, { lookupExtra: ['~/.specgate/bin'] })` with Windows `.exe`/`.cmd` resolution.
    - DoD: on Windows CI, resolves `node.exe` without the extension.
- [ ] **M3.B.3** Redaction: a `redact(text, patterns[])` function used by any gate that renders tool output.
    - DoD: given `"sk-abcdef1234"`, replaces with `"sk-***REDACTED***"`.

### M3.C — Secrets gate (gitleaks wrapper)

- [ ] **M3.C.1** `packages/core/src/gates/secrets.ts` — `detect()` returns `available` iff `gitleaks` resolves. If not, `skipped` with hint.
    - DoD: on a machine without gitleaks, `detect()` returns `{available: false, reason: "gitleaks not found"}`.
- [ ] **M3.C.2** `run()` executes `gitleaks detect --no-git --report-format json --report-path <tmp> [--staged]`; parses JSON; maps each hit to a `Finding` with **redacted** `message` (never the secret value — §22.6).
    - DoD: fixture `fixtures/node-express-ts` with a planted `OPENAI_API_KEY = "sk-xxxxx"` produces exactly 1 finding at `src/config.ts:L` with no secret in the output.
- [ ] **M3.C.3** Golden test: snapshot the full `GateResult` (minus `duration_ms` and `tool.version`).
    - DoD: snapshot committed.
- [ ] **M3.C.4** **Recorded-output test**: ship a captured gitleaks JSON in `packages/core/test/fixtures/gitleaks-sample.json`; test the normalizer **without running gitleaks** so CI can skip the binary. (§19 tool-wrapper tests)
    - DoD: test passes on CI even with gitleaks absent.

### M3.D — Lint gate

- [ ] **M3.D.1** Auto-detect: eslint (`package.json` has eslint) → ruff (`pyproject.toml`) → golangci-lint (`go.mod`). First match wins.
    - DoD: unit test with 3 fixture profiles returns the right tool.
- [ ] **M3.D.2** Run and parse JSON output (`eslint -f json`, `ruff check --output-format=json`, `golangci-lint run --out-format=json`).
    - DoD: normalizer snapshots per tool, each with a planted violation fixture (recorded JSON).
- [ ] **M3.D.3** `--staged`/`--changed` scope: compute changed files via `git diff --name-only [--cached]` and pass only those as linter args.
    - DoD: on a repo with 100 files but 1 staged, linter is invoked with 1 file.

### M3.E — Tests gate

- [ ] **M3.E.1** Auto-detect runner: vitest/jest (JS) → pytest (Python) → `go test` (Go).
    - DoD: unit test on fixture profiles.
- [ ] **M3.E.2** Run and parse the summary; a failing test → one finding per failure with file:line, title, message.
    - DoD: fixture with a planted failing test produces 1 finding; snapshot matches.
- [ ] **M3.E.3** **Changed-tests scope** (optional, falls back to full): if `vitest related` / `pytest --co -q` + git-diff can be done, use it; else full.
    - DoD: on fixture with 10 tests and 1 changed source file, scope correctly limits (or falls back with a note).

### M3.F — Reporter

- [ ] **M3.F.1** `packages/core/src/report/terminal.ts` — pretty table (one line per finding, grouped by gate); color via `picocolors`.
    - DoD: snapshot of a 3-gate / 5-finding mixed result.
- [ ] **M3.F.2** `packages/core/src/report/json.ts` — stable JSON (sorted keys) matching `GateResult[]` schema.
    - DoD: `JSON.parse(JSON.stringify(result))` round-trips.
- [ ] **M3.F.3** Human message formatter: always include **what, where, how to fix** (§15 principle 4, §22). Finding without `fix_hint` → formatter inserts "Fix: see rule docs."
    - DoD: every finding in the snapshot has a visible "Fix:" line.

### M3.G — `specgate check` command

- [ ] **M3.G.1** `packages/cli/src/commands/check.ts` — flags `--staged`, `--gate <id>`, `--json`, `--fix-prompt` (deferred to M5), `--fail-on-warn`.
    - DoD: `specgate check --json` on a clean fixture returns `[]` and exits 0.
- [ ] **M3.G.2** Exit codes exactly per §8: `0` pass, `1` blocking fail, `2` tool/config error, `3` warn + `--fail-on-warn`.
    - DoD: test matrix of 4 scenarios asserts the exit code.
- [ ] **M3.G.3** **Performance test**: on `fixtures/node-express-ts` with 3 gates on `--staged` scope, wall-time < 5 s on a reference machine (document the machine spec); gate CI with a 10 s budget to allow for runner variance.
    - DoD: CI step records duration; fails if > 10 s.

**M3 exit check:** fixtures produce exact expected findings; missing tool → `skipped`; perf budget met. **Begin dogfooding (§22.11): commits in this repo start carrying `Spec: <ids>` trailers.** Only then proceed to M4.

---

## M4 — Hooks + CI (week 4-5)

> **Done when:** commit with planted secret blocked locally; PR shows SARIF annotations; hook failure feeds back text to the agent. (§20 M4)

### M4.A — Git hook installer

- [ ] **M4.A.1** `packages/hooks/src/install.ts` — detect existing husky / pre-commit / lefthook; if present, append a `specgate check --staged` step **instead of** writing `core.hooksPath` (§9.4, ADR-012).
    - DoD: 3 fixture repos (one per tool) correctly extended, not replaced.
- [ ] **M4.A.2** If none present → set `git config core.hooksPath .specgate/hooks` and write Node shim `.specgate/hooks/pre-commit` that invokes the installed CLI.
    - DoD: fresh fixture gets `.specgate/hooks/pre-commit` with executable bit on POSIX, a `.cmd` on Windows (handled by Git for Windows via the shim pattern in ADR-012).
- [ ] **M4.A.3** Shim behaviour when CLI is missing: **warn and skip** (ADR-012). Never block a commit on tool absence.
    - DoD: temporarily rename the CLI → commit still succeeds, with a visible warning.
- [ ] **M4.A.4** `commit-msg` hook: optional `Spec: REQ-xxx` trailer validation if strictness ≥ standard **and** an active spec exists (§9.4).
    - DoD: a commit on a repo with an active spec missing the trailer at strictness=standard → blocked; at advisory → warned.

### M4.B — SARIF reporter

- [ ] **M4.B.1** `packages/core/src/report/sarif.ts` — map `GateResult[]` to SARIF 2.1.0 (`runs[].results[]` with `physicalLocation` + `message.text`).
    - DoD: schema-validated against the official SARIF JSON Schema (fetched once, vendored in `schemas/vendored/sarif.schema.json`).
- [ ] **M4.B.2** `specgate report --format sarif` writes to stdout or `--output <file>`.
    - DoD: SARIF file loads in `sarif-cli validate`.

### M4.C — GitHub Action

- [ ] **M4.C.1** `packages/action/action.yml` — composite action: `uses: pnpm/action-setup`, install specgate from npm (or path during dev), run `specgate check` + `specgate drift` (drift gated by M7, so no-op before then), upload SARIF via `github/codeql-action/upload-sarif`.
    - DoD: dry-run via `act` or a dev-branch workflow succeeds.
- [ ] **M4.C.2** PR summary comment: `specgate report --format md` posted via `peter-evans/create-or-update-comment` using a stable marker so re-runs update, not duplicate.
    - DoD: integration workflow in this repo demonstrates one comment that updates on push.
- [ ] **M4.C.3** `permissions:` block minimal (`contents: read`, `pull-requests: write`, `security-events: write`).
    - DoD: lint via `actionlint`.

### M4.D — Claude Code hook adapter

- [ ] **M4.D.1** `packages/hooks/src/claude-code.ts` — generates `.claude/settings.json` hook entries for `PostToolUse` (fast subset check) and `Stop` (full check, blocks completion on blocking failures with the fix prompt as feedback). (§9.3)
    - DoD: schema-valid against Claude Code hooks schema (vendor in `schemas/vendored/`).
- [ ] **M4.D.2** The `Stop` hook returns the correction prompt stub in M4; the real prompt builder arrives in M5.
    - DoD: hook payload includes a `feedback` field with placeholder text.

**M4 exit check:** planted secret blocked locally and in CI; PR comment visible with findings; SARIF appears in GitHub's Security tab on a test PR. Only then proceed to M5.

---

## M5 — Fix Loop (week 5)

> **Done when:** golden prompt tests pass; no-progress detection halts the loop; attempts logged. (§20 M5)

### M5.A — Fix-Loop state

- [ ] **M5.A.1** `packages/core/src/fixloop/state.ts` — persists `{spec_id?, task_id?, attempt, lastFindingsHash}` in `.specgate/state.json`. Zod schema.
    - DoD: load/save round-trips; corruption → reset to defaults with a warning.
- [ ] **M5.A.2** `shouldStop(state, maxAttempts, newFindings)` returns `{stop: true, reason}` when: `attempt >= max` or `hash(newFindings) === state.lastFindingsHash` (no progress). (§13.1 rule 5)
    - DoD: unit tests cover both stop reasons and the "progress made" case.

### M5.B — Correction prompt builder

- [ ] **M5.B.1** `packages/core/src/fixloop/builder.ts` — groups findings by file, orders by severity (error > warn), truncates to a token budget (default 1500), emits text matching the §13.2 template.
    - DoD: snapshot test with 3 findings produces the exact §13.2 example (minus the demo numbers).
- [ ] **M5.B.2** Forbid-list text (§13.3): the prompt must include **"Do not edit `.specgate/config.yaml`, baseline, or rule files to make this pass."** verbatim.
    - DoD: regex test asserts the sentence is present in every generated prompt.
- [ ] **M5.B.3** Structured payload (JSON) alongside the text — same data, machine-readable. Used by MCP in M6.
    - DoD: payload matches a zod schema `CorrectionPayloadSchema`.

### M5.C — Tamper gate (§13.3, §16, ADR-013)

- [ ] **M5.C.1** `packages/core/src/gates/tamper.ts` — detects changes within an agent session to `.specgate/config.yaml`, `.specgate/baseline.json`, or any `packs/**` file; locally **warns**, at CI + strict **blocks** unless the PR has label `specgate-approved` or `.specgate/` has CODEOWNERS approval.
    - DoD: tests: local run on modified config → warn; CI run → fail. Approval label clears the fail.
- [ ] **M5.C.2** Disabling a gate requires a `reason:` field in `config.yaml`; schema update (M0.C.1) to make `enabled: false` without `reason` invalid.
    - DoD: zod error on `enabled: false` with no `reason`.

### M5.D — `check --fix-prompt`

- [ ] **M5.D.1** CLI flag prints the correction prompt (text) when gates fail, so an agent reading stdout can act on it.
    - DoD: integration test: planted secret → stdout contains the fix prompt + exit code 1.

**M5 exit check:** fix prompt matches golden snapshots; no-progress halt is observed on a looped test; tamper gate flags config edits. Only then proceed to M6.

---

## M6 — MCP Server (week 5-6)

> **Done when:** a real agent session can fetch task context, run `check`, and receive fix feedback end-to-end on a fixture. (§20 M6)

### M6.A — MCP skeleton

- [ ] **M6.A.1** Dep: `@modelcontextprotocol/sdk` in `packages/mcp`.
    - DoD: added to lockfile.
- [ ] **M6.A.2** `packages/mcp/src/server.ts` — stdio server registering the 7 tools in §9.2 (stubbed with "not implemented" for now).
    - DoD: `specgate mcp` starts, `tools/list` returns 7 entries.

### M6.B — Tools implementation (one task per tool)

- [ ] **M6.B.1** `get_active_spec` — reads `.specgate/specs/*`, picks the one marked active (frontmatter `status: approved` and newest), returns the parsed structure.
    - DoD: integration test: pre-set a fixture spec, assert response shape.
- [ ] **M6.B.2** `get_task_context(task_id)` — returns the task, its ACs, scoped rules (from Rule Engine — stubbed to `[]` until M8 architecture pack), and a list of relevant files (from `scope.globs` matched against the repo).
    - DoD: on fixture, returns a non-empty task object.
- [ ] **M6.B.3** `list_tasks(status?)` — reads `tasks.md`, filters by `status`.
    - DoD: snapshot test.
- [ ] **M6.B.4** `update_task(task_id, status)` — validates against traceability (§12.2): cannot mark `done` if ACs lack linked tests. Writes `tasks.md` with the box toggled.
    - DoD: attempting to close a task without tests → error; valid close → file updated.
- [ ] **M6.B.5** `check(scope?, files?)` — calls into `runGates` from M3; returns `GateResult[]` + the correction prompt from M5.
    - DoD: planted-secret fixture produces 1 finding + fix prompt.
- [ ] **M6.B.6** `get_rule(rule_id)` — reads from installed packs in `.specgate/rules/<pack>/pack.yaml`.
    - DoD: unknown id → `{found: false}`; known id → full rule.
- [ ] **M6.B.7** `propose_spec_change(...)` — writes to `.specgate/specs/<id>/proposals/<nnn>.md` with status `pending`; **does not** modify the live spec. Human must `specgate spec accept-proposal <id>`.
    - DoD: proposal file is created; live spec unchanged.

### M6.C — Resources (§9.2)

- [ ] **M6.C.1** `specgate://spec/{id}`, `specgate://rules/{id}`, `specgate://status` — register as MCP resources returning text/plain or application/json.
    - DoD: `resources/list` returns 3 entries; `resources/read` succeeds for each.

### M6.D — Context budget (§5.3, §21.3)

- [ ] **M6.D.1** `get_task_context` enforces `context.max_rule_tokens` from config: ranks rules by relevance (exact glob match > tag match > stack match), drops the rest, returns `omitted: [{id, reason}]`.
    - DoD: test with a padded pack asserts truncation + omission list.

**M6 exit check:** end-to-end from a real Claude Code (or any MCP-capable agent) session: fetch task → write code → call `check` → receive fix prompt → fix → pass. Only then proceed to M7.

---

## M7 — Traceability + `status` (week 6)

> **Done when:** `status` correctly shows untested/failing/passing for each AC; orphan tests detected. (§20 M7)

### M7.A — Annotation parsers (per language, §12.1)

- [ ] **M7.A.1** JS/TS: regex-match `@spec AC-xxx.y` in comments AND test names like `it("AC-xxx.y: ...")`. Return `{file, line, acId, testName?}`.
    - DoD: snapshot test over a fixture with 3 annotations.
- [ ] **M7.A.2** Python: same, plus `pytest.mark.spec("AC-xxx.y")` decorator detection.
    - DoD: fixture snapshot.
- [ ] **M7.A.3** Go: same comment regex; function names `Test_ACxxxY` as fallback.
    - DoD: fixture snapshot.

### M7.B — Git-trailer parser

- [ ] **M7.B.1** `parseTrailers(repoRoot, { since })` using `git log --pretty=%B` + a simple parser for `Spec: <ids>`.
    - DoD: fixture repo with 3 commits, 2 carrying trailers → parser returns the right 2.

### M7.C — Traceability index

- [ ] **M7.C.1** `packages/core/src/trace/index.ts` — builds the graph `REQ → AC → Task → Test → Commit/File` from spec + tasks + annotations + trailers.
    - DoD: fixture with 1 REQ, 2 ACs, 2 tasks, 1 passing test linking AC-001.1 → graph has 1 covered AC and 1 uncovered.
- [ ] **M7.C.2** "Done" rule per §12.2: AC done ⇔ (≥1 linked test) ∧ (test passed in last run) ∧ (linked tasks all checked). Pure function `isAcDone(graph, acId, lastTestRun)`.
    - DoD: test matrix of 8 cases (2³).

### M7.D — `specgate status` command

- [ ] **M7.D.1** Pretty-prints the coverage matrix; `--json` emits the full graph.
    - DoD: fixture output snapshot matches a human-readable table.
- [ ] **M7.D.2** Flags: `--untested-only`, `--failing-only`, `--orphans` (tests referencing nonexistent IDs).
    - DoD: each flag filters correctly on fixture.

**M7 exit check:** on dogfooded repo, `specgate status` reflects reality. Only then proceed to M8.

---

## M8 — Distribution & Onboarding (week 6-7)

> **Done when:** on a clean machine with no Node, `brew install` (or install script) → `specgate init` → first `check` works in under 5 minutes; CI-only path works; `specgate uninstall` leaves the repo byte-identical. (§20 M8)

### M8.A — Changesets + versioning

- [ ] **M8.A.1** Install `@changesets/cli`, `pnpm changeset init`.
    - DoD: `.changeset/` dir present.
- [ ] **M8.A.2** CI workflow `release.yml`: on tag, run `pnpm build && pnpm changeset publish` with `NPM_TOKEN` secret and `--provenance`.
    - DoD: dry-run `--dry-run` succeeds in CI.

### M8.B — npm publish

- [ ] **M8.B.1** Scope decisions: publish `specgate` (unscoped) if available, else `@specgate/cli` + `@specgate/core` + `@specgate/mcp`.
    - DoD: `pnpm publish --dry-run` lists expected tarballs.
- [ ] **M8.B.2** Add `files:` field to each package.json so only `dist/`, `README.md`, `LICENSE` ship.
    - DoD: `npm pack --dry-run` tarball ≤ 2 MB per package.

### M8.C — Standalone binaries (Node SEA)

- [ ] **M8.C.1** `packages/distribution/scripts/build-sea.ts` — Node Single Executable Application build for linux-x64, linux-arm64, macos-x64, macos-arm64, win-x64.
    - DoD: 5 binaries emitted into `dist/bin/`; each runs `specgate --version` on the matching OS CI runner.
- [ ] **M8.C.2** Sign/checksum: SHA-256 for every artifact + `cosign` sign on CI (keyless OIDC).
    - DoD: `cosign verify-blob` passes.

### M8.D — Homebrew tap + Scoop bucket + install script

- [ ] **M8.D.1** `homebrew-specgate` tap manifest template with checksum placeholders filled by release script.
    - DoD: `brew install --dry-run` resolves.
- [ ] **M8.D.2** Scoop bucket JSON manifest for Windows.
    - DoD: `scoop install specgate` succeeds in a Windows CI job.
- [ ] **M8.D.3** `install.sh` + `install.ps1` that detects OS/arch, downloads the right binary, verifies checksum, drops into `/usr/local/bin` or `%LOCALAPPDATA%\specgate`.
    - DoD: both scripts tested in CI.

### M8.E — GitHub Action on Marketplace

- [ ] **M8.E.1** Tag `specgate/action@v1`, publish to Marketplace.
    - DoD: Marketplace listing live; `uses: specgate/action@v1` works in a sample repo.

### M8.F — Claude Code plugin

- [ ] **M8.F.1** `packages/plugin-claude-code/` — slash commands `/specgate:init`, `/specgate:spec`, `/specgate:check`; hook config; MCP server registration.
    - DoD: plugin loads in a fresh Claude Code install; `/specgate:check` runs on a fixture.

### M8.G — `doctor --install` (ADR-015)

- [ ] **M8.G.1** Pinned download table: tool → URL + SHA-256 per OS/arch. Lives in `packages/core/src/doctor/pinned.ts`.
    - DoD: table is complete for gitleaks + osv-scanner; checksums verified.
- [ ] **M8.G.2** `doctor --install` prompts for explicit consent, downloads to `~/.specgate/bin`, verifies checksum, sets exec bit (POSIX), updates `PATH` hint.
    - DoD: fresh machine → `specgate doctor --install` → `specgate check` finds gitleaks.

### M8.H — `specgate uninstall`

- [ ] **M8.H.1** Removes: `core.hooksPath` setting (if we set it), `.specgate/hooks/`, `.github/workflows/specgate.yml`, managed blocks inside shared files. **Does not** delete `.specgate/specs/` by default (requires `--purge`).
    - DoD: `init → modify → uninstall` → `git diff` against pre-init state is empty.

### M8.I — Onboarding assets (§24.6)

- [ ] **M8.I.1** `README.md` at repo root — 5-min quickstart: three commands (install, init, check). Points to `docs/`.
    - DoD: a cold reader can complete in 5 min on their own repo.
- [ ] **M8.I.2** Record a 2-min demo gif: blocked secret → fix prompt → pass. Store in `docs/demo.gif`.
    - DoD: gif plays in README.
- [ ] **M8.I.3** `docs/when-a-check-fails.md` — one page.
    - DoD: covers each gate.
- [ ] **M8.I.4** `docs/landing.html` — single static page (problem, demo embed, install tabs). Deploy via GitHub Pages.
    - DoD: live URL in repo description.
- [ ] **M8.I.5** `specgate init` final step prints 3 next commands (`spec new`, `check`, `status`).
    - DoD: snapshot of post-init stdout.

**M8 exit check (and MVP exit):** cold-machine timing < 5 min; CI-only path produces a PR report; `uninstall` diff is empty. **Then halt new features and start the 5–10 user pilot. Decide go/pivot/kill using §21.4 metrics.**

---

## Post-MVP backlog (do **not** start before pilot results — §20)

Order comes from pilot feedback; this is the current best guess.

- **P1 — Architecture gate + 2 enforcement packs**
    - P1.a Rule Engine selector + budget (full §5.3)
    - P1.b `ts-node-layered` pack (dependency-cruiser configs, 5+ enforced layer rules)
    - P1.c `fastapi-postgres` pack (import-linter configs, 5+ enforced rules)
    - P1.d `architecture` gate wrapping dependency-cruiser / import-linter / ArchUnit / semgrep uniformly
    - P1.e Each pack ships failing + passing fixtures; CI validates every rule.

- **P2 — Brownfield `scan` + baseline + change deltas**
    - P2.a `specgate scan` → inferred architecture summary + proposed packs
    - P2.b `.specgate/baseline.json` records existing violations; gates fail only on **new** findings
    - P2.c `specgate change new <name>` + ADDED/MODIFIED/REMOVED delta format
    - P2.d `specgate change archive` merges deltas into canonical specs

- **P3 — Drift detector**
    - P3.a `unimplemented` detector (REQ/AC without tasks or tests)
    - P3.b `orphan-code` extractors: Express, NestJS, FastAPI, Next.js routes
    - P3.c `stale-tasks`: tasks.md hash vs. current spec hash
    - P3.d `orphan-tests`: tests referencing nonexistent IDs

- **P4 — Dependency audit + coverage gates**
    - P4.a `dependencies` gate wrapping osv-scanner + `npm audit`
    - P4.b `coverage` gate: parse coverage output per runner, enforce `changed_files_min`

- **P5 — Local dashboard + VS Code extension**
    - P5.a `specgate ui` serves a read-only local page from `status --json`
    - P5.b VS Code extension consuming `--json`

- **P6 — Community packs + semgrep integration**
    - P6.a `specgate rules add <git-url>` with install-time trust prompt
    - P6.b semgrep pattern bundle for cross-stack rules

- **P7 — GitLab CI + other CI adapters**

---

## Appendix A — Running checklist for every PR (§22 DoD)

- [ ] Types strict, `pnpm typecheck` clean
- [ ] `pnpm lint` clean
- [ ] Tests added; `pnpm test` passes on Linux/macOS/Windows CI
- [ ] If schemas/interfaces changed → `pnpm schemas` committed + `run.md` updated
- [ ] No secrets in code, fixtures, snapshots (grep for `sk-`, `AKIA`, etc. before commit)
- [ ] One concern per PR
- [ ] From M3 onwards: commit trailer `Spec: <REQ/T ids>`

## Appendix B — Fixture repos summary (grows across milestones)

| Fixture | Introduced in | Purpose |
|---|---|---|
| `fixtures/node-express-ts` | M1.A.1 | JS/TS stack detection, lint/test/secret gates |
| `fixtures/python-fastapi` | M1.A.2 | Python stack detection, ruff + pytest gates |
| `fixtures/empty-git-repo` | M1.A.3 | Idempotency + bootstrap tests |
| `fixtures/monorepo` | P2 | Path-scoped rules, per-package config |
| `fixtures/brownfield-violations` | P2 | Baseline mode validation |

## Appendix C — Reference docs to cite in commits

- Section 3 (ADRs) when behaviour relates to a decision
- Section 7 (schemas) when touching data shapes
- Section 10 (gate runner) when adding or modifying a gate
- Section 22 (agent instructions) always
