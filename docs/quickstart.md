# 5-minute quickstart

Target: from zero to a first `specgate check` in under five minutes.

## 0. Install

Pick one:

| How                                   | Command                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| npm (JS/TS devs)                      | `npx @specgate/cli init`                                                                       |
| Homebrew (macOS/Linux)                | `brew install specgate/tap/specgate`                                                           |
| Scoop (Windows)                       | `scoop bucket add specgate https://github.com/specgate/scoop-bucket && scoop install specgate` |
| curl (any POSIX)                      | `curl -fsSL https://specgate.dev/install.sh \| sh`                                             |
| PowerShell (Windows)                  | `iwr -useb https://specgate.dev/install.ps1 \| iex`                                            |
| GitHub Action only (no local install) | add `.github/workflows/specgate.yml` using `specgate/action@v1`                                |

## 1. Initialise your repo

```bash
cd ~/my-project
specgate init --yes
```

What it does:

- Detects your stack (`.specgate/stack.json`).
- Writes `.specgate/config.yaml` with `strictness: standard`.
- Injects the managed-block in `AGENTS.md` (**never clobbers user content outside the markers**).
- Writes `.specgate/.gitignore` for `reports/` + `state.json`.

Re-running `specgate init --yes` is a no-op (byte-identical result).

## 2. Describe your first feature

```bash
specgate spec new
```

The 7-question interview writes `.specgate/specs/001-<slug>/requirements.md` with status `draft`. Edit the file to flesh out the ACs. Then:

```bash
specgate spec validate SPEC-001   # catches E_UNTESTABLE_AC, E_EMPTY_AC, …
specgate spec approve  SPEC-001   # freezes IDs → writes ids.lock.json
specgate spec plan     SPEC-001   # writes design.md
specgate spec tasks    SPEC-001   # writes tasks.md with implements: AC-xxx.y
```

After approval, deleting an id without marking it `~~deprecated~~` is rejected on next `validate` (`E_IMMUTABLE_REMOVAL`).

## 3. Install git + agent hooks

```bash
specgate hooks install        # pre-commit + commit-msg shims
specgate hooks claude-code    # .claude/settings.json (optional)
```

If husky / pre-commit / lefthook is already in the repo, SpecGate **integrates** into the existing config via managed-block edits — it never clobbers.

## 4. Run gates

```bash
specgate check                # terminal report
specgate --json check          # machine-readable JSON
specgate check --staged        # fast pre-commit scope
specgate check --fix-prompt    # emit the §13.2 fix prompt on failure
specgate check --gate secrets  # single gate
```

Exit codes (run.md §8): `0` pass · `1` blocking failure · `2` tool/config error · `3` warn-only with `--fail-on-warn`.

## 5. Verify traceability

```bash
specgate status
specgate status --json
specgate status --untested-only
specgate status --failing-only
specgate status --orphans    # tests citing AC ids that no spec contains
```

An AC is `done` iff it has at least one linked test AND every task that `implements:` it is checked.

## Uninstall

```bash
specgate uninstall             # removes hooks + managed blocks (keeps specs)
specgate uninstall --purge     # also deletes .specgate/ (specs + config)
```

`uninstall --purge` leaves the repo byte-identical to the pre-`init` state.
