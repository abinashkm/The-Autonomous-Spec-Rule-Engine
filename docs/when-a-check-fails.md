# A `specgate check` failed — now what?

The check runner always emits two things on failure:

1. A **Problem / Fix** line per finding (gate + file + line).
2. A **fix prompt** (`specgate check --fix-prompt`) you can paste into any agent.

The fix prompt is designed to **minimise the agent's context**: it's grouped by severity, truncated to a token budget, and starts with the forbid-list text from [run.md §13.3](../run.md#13-fix-loop) — do not weaken gates to make them pass.

---

## By gate

### `secrets` (gitleaks) failed

The committed value matched a known secret pattern. **Do not** copy the secret into your commit message or notes — SpecGate redacts it in all outputs.

```bash
# 1. Move the value to a .env (gitignored)
echo 'OPENAI_API_KEY=sk-...' >> .env
echo '.env' >> .gitignore
# 2. Reference process.env.X in code
# 3. Add a placeholder to .env.example
echo 'OPENAI_API_KEY=' >> .env.example
# 4. Rotate the leaked key (always — the git blob history still contains it)
```

### `lint` failed

Look at the file / line / rule the finding reports; most are auto-fixable:

```bash
# JS / TS
npx eslint --fix <file>
# Python
ruff check --fix <file>
# Go
# (no autofix — resolve the shadow / ineffassign / etc. manually)
```

### `tests` failed

The test runner (vitest / jest / pytest / go test) reported one or more failing assertions. The fix prompt lists each failure with the test name — fix the implementation (or the test if the spec changed). Running `specgate check` again verifies.

### `spec` / tamper failed

SpecGate flagged an edit to `.specgate/config.yaml`, `.specgate/baseline.json`, `packs/`, or `.specgate/rules/`. Locally this is a warning; **in CI at strict it blocks the merge** (ADR-013) unless the PR has CODEOWNERS approval or the `specgate-approved` label.

If you intentionally changed the config (e.g. tightened strictness, added a pack), get a human review. Do not use `--no-verify` to bypass the local hook; CI will catch it anyway.

---

## Running out of attempts

By default the fix loop stops after 3 attempts (configurable via `fix_loop.max_attempts`). It also stops when the same findings repeat ("no-progress"). When either happens:

- `.specgate/state.json` records `attempt` + `lastFindingsHash` so a human can resume where you left off.
- Run `specgate check --fix-prompt` to re-emit the prompt — SpecGate will _not_ give you a fresh counter, but it will show you the current blocking set.
- To reset the loop (e.g. after a human intervention), delete `.specgate/state.json`.

---

## Known pitfalls

- **Gitleaks not installed → every secrets run is `skipped`.** This is intentional (ADR-015). Install via `specgate doctor --install` (prompts for consent).
- **Hooks skipped locally** — this is the ADR-012 "warn and skip" behaviour. CI is the non-bypassable backstop; a missing local tool should never block a teammate's commit.
- **AGENTS.md was moved / renamed** — SpecGate only writes inside its managed-block markers. If you move the file, re-run `specgate init` to re-create the block at the new location (user content outside markers is preserved).
