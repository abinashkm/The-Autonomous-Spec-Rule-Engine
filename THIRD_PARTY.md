# Third-party notices

SpecGate is licensed under Apache-2.0 (see [LICENSE](LICENSE)).

**No third-party text bundled yet.**

When we add vendored third-party content (rule-pack prose, tool configs, docs excerpts), each entry below must include:

- Project / source URL
- License (SPDX identifier)
- What was taken (verbatim text, config, pattern, …)
- Where it lives in this repo
- Date added

The CI license check (ADR-009, run.md §21.3) refuses to merge new vendored content that is missing any of these fields.

## Dependencies

Runtime and build-time npm dependencies carry their own licenses in `node_modules/<pkg>/LICENSE`. A machine-readable aggregation will be generated under `docs/dependency-licenses.json` by `pnpm run licenses` (added in M8).

## Reference projects

The projects listed in run.md §23 (spec-kit, agent-rules-books, gitleaks, OpenSpec, semgrep, dependency-cruiser, eslint-plugin-boundaries, import-linter, ArchUnit, osv-scanner) are referenced for inspiration only. **No text or configuration from them is bundled in this repository.** If and when any is bundled, it must appear in the table above with its license verified.
