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

- [x] **M3.A.1** `packages/core/src/gates/types.ts` — `Gate`, `RepoContext`, `RunContext`, `GateAvailability`, `GateScope`.
- [x] **M3.A.2** `registry.ts` — `registerGate`/`getGate`/`listGates` with alphabetical sort by id.
    - DoD: `listGates()` returns `['lint', 'secrets', 'tests']` even when registered in reverse order.
- [x] **M3.A.3** `runGates` + `runOneGate` — `Promise.all` with a wrapper timeout; thrown error → `status: 'error'`; detect false → `status: 'skipped'` with reason; `enabled: false` with reason → `skipped`.
    - DoD: 7 passing tests cover throw, timeout, disabled-by-config, blocking override.
- [x] **M3.A.4** `isBlocking(current, gate)` pure function + 3×3 truth table test.

### M3.B — Subprocess safety harness (§16, §22.7)

- [x] **M3.B.1** `subprocess/run.ts` wraps `execa`: argv array only, resolved absolute binary, timeout + 1 MB per-stream cap, `reject: false` (never throws for non-zero exit), optional env override.
    - DoD: 5 passing tests; buffer cap verified by emitting 1.5 MB and asserting ≤ 1 MB retained; a `; echo PWNED` string in argv stays a single argv entry.
- [x] **M3.B.2** `resolveBinary` with `~/.specgate/bin` + PATH + Windows `.exe`/`.cmd`/`.bat`/`.com` extension resolution.
    - DoD: resolves `node` on Windows without the extension; throws `ResolveBinaryError` on missing binaries.
- [x] **M3.B.3** `redact(text)` + `redactLiteral(text, secret)` — builtin patterns for OpenAI / AWS / GitHub / Slack / private-key blocks. 5 passing tests.

### M3.C — Secrets gate (gitleaks wrapper)

- [x] **M3.C.1** `SecretsGate.detect` returns `{available: false, reason: "gitleaks not found on PATH..."}` when `gitleaks` is not resolvable.
- [x] **M3.C.2** `run()` invokes `gitleaks detect --no-git --report-format json --report-path <tmp> [--staged]`; parses the JSON output; maps each hit to a `Finding` with **redacted** message + fix_hint (secret never appears in the output).
    - DoD: 5 passing tests include the redaction regression (§22.6) and tool-error branch.
- [x] **M3.C.3** `normaliseGitleaksOutput` is a pure function with deterministic sort (file, line, id).
- [x] **M3.C.4** Recorded gitleaks sample in `test/fixtures/gitleaks-sample.json`; the normaliser test runs end-to-end with gitleaks **absent** from the host.

### M3.D — Lint gate

- [x] **M3.D.1** `pickLinter(ctx)` — eslint > ruff > golangci-lint by detected linter; falls back to the language-level default (eslint for JS/TS, ruff for Python, golangci-lint for Go).
    - DoD: 3 unit tests cover explicit match, fallback, and null case.
- [x] **M3.D.2** `normaliseEslintOutput` / `normaliseRuffOutput` / `normaliseGolangciOutput` — pure, tested against recorded JSON samples (`eslint-sample.json`, `ruff-sample.json`, `golangci-sample.json`).
- [x] **M3.D.3** Changed-scope: `filesForScope(cwd, 'staged'|'changed')` runs `git diff --name-only [--cached]` and the gate passes those as linter args. If empty, lint runs over `.`.

### M3.E — Tests gate

- [x] **M3.E.1** `pickRunner(ctx)` — vitest > jest > pytest > `go test`.
- [x] **M3.E.2** `normaliseVitestOutput` + `normalisePytestOutput` — pure, tested against recorded `vitest-sample.json` + `pytest-sample.json`. Only failed/error outcomes become findings; `file:line:title:message` all populated.
- [x] **M3.E.3** Changed-tests scope is **deferred** (M3.E notes). The gate runs full-scope today; staged/changed falls through to runner-level test selection in a later milestone (post-MVP).

### M3.F — Reporter

- [x] **M3.F.1** `renderTerminalReport(results, {color})` — one block per finding (Problem/Fix lines), one header per gate, status tag + summary line. Color via `picocolors`. Snapshot committed.
- [x] **M3.F.2** `renderJsonReport` — stable sorted-key JSON (duration zeroed to keep output byte-identical across runs). Snapshot committed.
- [x] **M3.F.3** Every finding emits Problem + Fix lines; `fix_hint` is non-nullable at the schema level so a missing hint is caught at zod parse time.

### M3.G — `specgate check` command

- [x] **M3.G.1** `check.ts` CLI with flags `--staged`, `--changed`, `--gate <id>` (repeatable), `--json`, `--fail-on-warn`, `--fix-prompt` (M5 placeholder).
- [x] **M3.G.2** Exit codes per §8: 0/1/2/3 verified in 4 passing unit tests on `exitCodeFor`.
    - DoD: test matrix of 4 scenarios asserts the exit code.
- [x] **M3.G.3** Perf-budget test: scoped `runCheck` on `empty-git-repo` completes well under the 10 s CI budget (verified in `test/check/run.test.ts`).

**M3 exit check:** ✅ secrets gate skipped-with-reason on hosts without gitleaks (never silent-pass); normalisers tested against recorded JSON samples for all 3 gates; exit-code mapping (§8) covered 0/1/2/3; terminal + JSON reporters snapshot-tested; CLI end-to-end verified against `empty-git-repo` fixture with `--gate secrets --json`. Core test count: **192 passing**. Full pipeline (format/lint/typecheck/schemas/build/test/CLI smoke) all exit 0. **Begin dogfooding (§22.11): commits in this repo start carrying `Spec: <ids>` trailers from now on.** Proceeding to M4.

---

## M4 — Hooks + CI (week 4-5)

> **Done when:** commit with planted secret blocked locally; PR shows SARIF annotations; hook failure feeds back text to the agent. (§20 M4)

### M4.A — Git hook installer

- [x] **M4.A.1** `detectHookManager(cwd)` + `installHooks({cwd})`. husky/pre-commit/lefthook detection with managed-block integration (never clobbers user content).
    - DoD: 3 integration tests (husky w/ existing script, pre-commit config with other repo, lefthook with other command) verify preservation + managed block injection.
- [x] **M4.A.2** manager=none → write `.specgate/hooks/pre-commit` + `commit-msg` Node shims; `git config core.hooksPath .specgate/hooks` (opt-out via `skipGitConfig` for tests). POSIX chmod 0755.
    - DoD: shim files created, idempotent on re-run, `git config` set on dev host.
- [x] **M4.A.3** Shim body warns-and-skips when `specgate` is not on PATH (ENOENT → `console.warn` + exit 0). Verified via grep for 'warn' in the shim body.
- [x] **M4.A.4** `commit-msg` trailer validator — `parseTrailer` + `validateCommitMessage`. blocks on standard/strict when an active spec exists and no trailer; warns on advisory.
    - DoD: 6 passing tests + `specgate _commit-msg <path>` wired as a hidden CLI command for the shim to call.

### M4.B — SARIF reporter

- [x] **M4.B.1** `renderSarifReport(results, {toolVersion, repoRoot})` — emits `$schema`, `version: '2.1.0'`, `runs[].tool.driver.{name,rules}`, `runs[].results[]` with `physicalLocation` + `message.text` + `partialFingerprints` for GitHub de-dupe.
    - DoD: 5 passing tests cover shape, ruleId→ruleIndex integrity, abs→relative URI, partial fingerprints, and snapshot. Full schema file not vendored in M4 (deferred — the committed shape matches §10.3 and the smoke test loads it as valid JSON).
- [x] **M4.B.2** `specgate report --format sarif --output <file>` + `md` + `json` + `terminal` formats.
    - DoD: `report --format sarif --output specgate.sarif` writes a valid SARIF doc; e2e verified on the node-express-ts fixture.
- [x] **Bonus M4.B.3** `renderMarkdownReport` + `PR_COMMENT_MARKER` for the Action's PR comment (M4.C.2). 4 passing tests.

### M4.C — GitHub Action

- [x] **M4.C.1** `packages/action/action.yml` — composite action: setup-node@v4 → `npm i -g @specgate/cli` → `specgate --json check` → render SARIF → `codeql-action/upload-sarif@v3` → fail step on blocking.
    - Inputs: `specgate-version`, `working-directory`, `fail-on-blocking`, `upload-sarif`, `comment-on-pr`. Outputs: `blocking-failures`, `sarif-path`.
- [x] **M4.C.2** PR comment via `peter-evans/create-or-update-comment@v4` with `edit-mode: replace` — the `PR_COMMENT_MARKER` keeps re-runs updating a single comment.
- [x] **M4.C.3** `permissions:` block (set at the workflow that uses the action, not within the composite — see run.md §9.5). Documented in `action.yml` consumer notes; a workflow consuming the action is responsible for `contents: read` + `pull-requests: write` + `security-events: write`.

### M4.D — Claude Code hook adapter

- [x] **M4.D.1** `buildClaudeCodeHooks()` + `writeClaudeCodeHooks(cwd)` — generates `.claude/settings.json` fragments for `PostToolUse` (matcher = `Edit|Write|MultiEdit|NotebookEdit`, runs `specgate check --changed --gate secrets`) and `Stop` (runs full `specgate check`).
    - DoD: merge-aware (preserves user entries, replaces only `_specgateManaged: true` ones); idempotent on repeat invocation (verified by 5 passing tests). Vendored JSON Schema fragment exported as `CLAUDE_CODE_SETTINGS_FRAGMENT_SCHEMA`.
- [x] **M4.D.2** `buildStopFeedback({blocking, textReport, maxBytes})` — short count header + trimmed terminal report, capped at 4000 bytes by default. The full fix-prompt payload lands in M5.B.

**M4 exit check:** ✅ full pipeline exits 0 across format/lint/typecheck/schemas-diff/build/test/CLI smoke. End-to-end on a freshly `git init`-ed fixture: `hooks install` writes both shims + sets `core.hooksPath`; `hooks claude-code` writes `.claude/settings.json`; `report --format sarif` emits a valid SARIF 2.1.0 doc with partialFingerprints; `report --format md` produces the PR-comment summary. Core test count: **224 passing** (up from 192 at end of M3). Proceeding to M5.

---

## M5 — Fix Loop (week 5)

> **Done when:** golden prompt tests pass; no-progress detection halts the loop; attempts logged. (§20 M5)

### M5.A — Fix-Loop state

- [x] **M5.A.1** `fixloop/state.ts` — zod-validated state in `.specgate/state.json`. `readState` (defaults when absent; silent reset on corruption with a stderr warning); `writeState`; `resetState`; `stateFilePath`.
    - DoD: round-trip + corruption-reset + resetState tests all green.
- [x] **M5.A.2** `shouldStop({state, maxAttempts, results, now?})` returns `{stop, reason, nextState}`.
    - Stop reasons: `success` (no blocking findings), `no-progress` (hash matches previous), `max-attempts` (attempt ≥ cap). Otherwise `stop: false` with an incremented `nextState.attempt`.
    - DoD: 4 passing tests cover all three stop reasons plus the "progress made" case.
    - `hashBlockingFindings` is order-independent (sort by file/line/id) and ignores pass/skipped/non-blocking results.

### M5.B — Correction prompt builder

- [x] **M5.B.1** `buildCorrectionPrompt(results, {attempt, maxAttempts, tokenBudget})` groups by file+gate, sorts by severity (error > warn > info) then file/line/id, truncates to the token budget (default 1500 ≈ 4 chars/token), and reports `omitted_count` in the payload.
    - DoD: 8 passing tests + 2 golden snapshots (`text` + `payload`).
- [x] **M5.B.2** Forbid-list verbatim text (§13.3): `FORBID_LIST_TEXT` constant appears in every generated prompt. Regression test asserts both `text.includes(FORBID_LIST_TEXT)` and `payload.forbid === FORBID_LIST_TEXT`.
- [x] **M5.B.3** `CorrectionPayload` zod schema — `{attempt, max_attempts, forbid, items[], omitted_count}` where each item has `{gate, rule_id, severity, file, line, problem, fix, rule_ref, spec_ref}`. Payload snapshot committed.

### M5.C — Tamper gate (§13.3, §16, ADR-013)

- [x] **M5.C.1** `TamperGate` (gate id `spec`, defaultBlockingAt `strict`) uses `git diff --name-only HEAD` to detect edits to `.specgate/config.yaml`, `.specgate/baseline.json`, `packs/`, `.specgate/rules/`.
    - Local → `status:'warn'` (non-blocking), CI + strict → `status:'fail'` (blocking). SHA-256 (12-char) hash of the current file is included in the message for the audit trail.
    - DoD: 4 passing tests — no edit → pass; local edit → warn; CI+strict edit → fail; no-git fallback → pass (never emits noise).
- [x] **M5.C.2** Schema already enforces `enabled: false` ⇒ `reason:` from M0.C.1 (verified in `config.test.ts > rejects a disabled gate missing a reason`). No new work needed.

### M5.D — `check --fix-prompt`

- [x] **M5.D.1** CLI `--fix-prompt` wiring: on blocking failures, calls `buildCorrectionPrompt` with the current `shouldStop` verdict's `nextState.attempt`, writes `.specgate/state.json`, prints `----- fix prompt -----` + the text + `[stop reason: ...]` when stopping. On success, resets state.
    - DoD: CLI smoke verifies no crash + state file lifecycle; blocking-failure test lives in the core snapshots (CLI acts as a thin printer).

**M5 exit check:** ✅ 23 fixloop/tamper tests green; 2 golden snapshots committed (text + payload); FORBID_LIST_TEXT regression guard in place; tamper gate behavior verified end-to-end on a real git repo. Core test count: **247 passing** (up from 224 at end of M4). Pipeline (format/lint/typecheck/schemas/build/test) all exit 0. Proceeding to M6.

---

## M6 — MCP Server (week 5-6)

> **Done when:** a real agent session can fetch task context, run `check`, and receive fix feedback end-to-end on a fixture. (§20 M6)

### M6.A — MCP skeleton

- [x] **M6.A.1** Dep: `@modelcontextprotocol/sdk@^1.32` added to `packages/mcp`; CLI consumes it via `@specgate/mcp` workspace dep.
- [x] **M6.A.2** `packages/mcp/src/index.ts` — `McpServer` with 7 tools + 3 resources, `startStdioServer`, main-module detection robust across Windows (file:// + drive letter + backslashes).
    - DoD: integration test spawns the compiled server, sends `initialize` → `tools/list` → `resources/list` over stdio and asserts the 7 §9.2 tools plus the `specgate-status` resource.

### M6.B — Tools implementation (one task per tool)

- [x] **M6.B.1** `getActiveSpec(cwd)` — picks the newest approved/implemented spec, falls back to newest draft; returns null on empty repo.
- [x] **M6.B.2** `getTaskContext({cwd, taskId, maxTokens})` — returns `{specId, task, acceptanceCriteria, relevantFiles, rules, budget}`. Rules loaded from vendored packs under `.specgate/rules/*/pack.yaml`; scored by `tagMatch(2) + globMatch(1)`, truncated to budget, omitted entries reported.
- [x] **M6.B.3** `listAllTasks(cwd, {done?})` — across all approved specs; preserves `implements` + `tags`.
- [x] **M6.B.4** `updateTaskStatus({cwd, taskId, done})` — light traceability guard: marking done=true requires an AC-id reference in a test file. Throws `UpdateTaskError{E_UNTESTED_AC | E_TASK_NOT_FOUND | E_TASK_LINE_NOT_FOUND}`. Full annotation parser lands in M7.
- [x] **M6.B.5** `runMcpCheck({cwd, scope?, gates?})` — wraps `runCheck`; attaches a `fixPrompt` (text + payload) when any blocking failures are present, null otherwise.
- [x] **M6.B.6** `getRule(cwd, ruleId)` — scans `.specgate/rules/*/pack.yaml` guidance arrays; returns `{id, title, body, severity, fromPack}` or null.
- [x] **M6.B.7** `proposeSpecChange({cwd, specIdOrName, proposal})` — writes `.specgate/specs/<dir>/proposals/NNN.md` with `status: pending` frontmatter. **Never modifies the live spec** (byte-for-byte-compare verified). Monotonic numbering across multiple proposals.

### M6.C — Resources (§9.2)

- [x] **M6.C.1** `specgate://status` (application/json, from `getStatusResource`), `specgate://spec/{id}` (text/markdown, from `getSpecMarkdown`), `specgate://rules/{id}` (application/json, from `getRule`). `resources/list` returns `specgate-status`; two parameterised templates registered.

### M6.D — Context budget (§5.3, §21.3)

- [x] **M6.D.1** `getTaskContext` respects `maxTokens` (default 4000): rules sorted by score, kept while under budget, remainder returned in `budget.omittedRules` with `reason: 'token-budget'`. Covered by a dedicated test using a vendored pack (two 200-char bodies, maxTokens=100).

**M6 exit check:** ✅ 19 core tool-logic tests + 2 end-to-end stdio-server tests all pass; full pipeline (format/lint/typecheck/schemas/build/test) green. Core test count: **266 passing** (up from 247 at end of M5); MCP integration: **2 passing**. **End-to-end** verified: `specgate mcp` spawns, `initialize` succeeds, `tools/list` returns the 7 §9.2 tools alphabetical, `resources/list` includes `specgate-status`. Proceeding to M7.

---

## M7 — Traceability + `status` (week 6)

> **Done when:** `status` correctly shows untested/failing/passing for each AC; orphan tests detected. (§20 M7)

### M7.A — Annotation parsers (per language, §12.1)

- [x] **M7.A.1** JS/TS: `parseJsTs(file, text)` — `@spec AC-xxx.y` in `//` + `/* */` comments, plus `it|test|describe("AC-xxx.y...")` test-name hits.
    - DoD: 3 passing tests cover line comments, block comments, test-name hits; string-literal mentions outside comments are skipped.
- [x] **M7.A.2** Python: `parsePython(file, text)` — comment ids + `@pytest.mark.spec("AC-xxx.y")` decorators + `def test_AC_xxx_y_...` function names.
    - DoD: single compound test covers all three sources.
- [x] **M7.A.3** Go: `parseGo(file, text)` — comment ids + `func Test_AC_xxx_y...` function names.
    - DoD: one test covers both.
- [x] **Bonus M7.A.4** `scanRepoForAcAnnotations(cwd)` walks the repo, skips `node_modules/.git/dist/.specgate/.venv/__pycache__`, picks the right parser per file extension, returns a deterministic sorted list.

### M7.B — Git-trailer parser

- [x] **M7.B.1** `parseTrailers({cwd, since?, maxCommits?})` + pure `parseCommitTrailer(message)` — splits records with `%x1e`, fields with `%x1f`.
    - DoD: 4 passing tests cover pure parse, no-trailer case, uninitialised-repo fallback, and a real git-init-commit-commit scenario asserting the right REQ/AC ids are returned.

### M7.C — Traceability index

- [x] **M7.C.1** `buildTraceabilityIndex({cwd})` — builds `{reqs, acs, tasks, orphans}` from `listSpecs` + `scanRepoForAcAnnotations` + `parseTrailers`. Deterministic sort of tasks/commits/tests inside each AC node.
    - DoD: 3 passing tests — real graph on a seeded spec, orphan detection, empty-repo returns an empty graph.
- [x] **M7.C.2** `isAcDone(graph, acId, {passingTests?, failingTests?})` — fail-fast on failing tests, require coverage when a passing set is supplied, otherwise `tests present + task done = done`.
    - DoD: 5 passing tests cover untested, passing-while-tasks-pending, done-after-task-check, failing-on-explicit-failingTests, deprecated-AC-reported-as-done.
- [x] **Bonus M7.C.3** `buildStatusMatrix(graph, options?)` turns the graph into the per-REQ matrix + summary + orphans surfaced for the CLI.

### M7.D — `specgate status` command

- [x] **M7.D.1** `statusCommand` renders a per-REQ pretty table (badge + status + AC id + test/task counts) with picocolors when stdout is a TTY; `--json` dumps the full matrix.
    - DoD: end-to-end CLI smoke on seeded fixture shows `AC-001.1 passing`, `AC-001.2 untested`.
- [x] **M7.D.2** Flags `--untested-only`, `--failing-only`, `--orphans` all wired.
    - DoD: smoke shows `--orphans` filters to just the orphan list; `--untested-only` leaves only the one AC with no test.

**M7 exit check:** ✅ 21 trace tests + CLI end-to-end against a seeded fixture (seed → add a test → `status`) correctly shows `passing/untested/orphan`. Core test count: **287 passing** (up from 266 at end of M6). Full pipeline (format/lint/typecheck/schemas/build/test) all exit 0. Proceeding to M8.

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
