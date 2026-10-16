import { readFileSync } from 'node:fs';
import { listSpecs } from '../spec/workflow.js';
import type { Config } from '../schemas/config.js';

/**
 * `Spec: REQ-xxx, T-yyy` trailer validation for `commit-msg`.
 * Source of truth: run.md §9.4 + §12.1.
 *
 * Behaviour (ADR-012 "warn and skip" when the context is incomplete):
 *   - strictness `advisory` → warn only (never block)
 *   - strictness `standard` or `strict` → block iff an active spec exists
 *                                         and the trailer is missing or
 *                                         references ids that don't exist.
 */

const TRAILER_RE = /^Spec:\s*(.+)$/m;
const ID_RE = /\b(REQ-\d{3}|T-\d{3}|AC-\d{3}\.\d+)\b/g;

export type TrailerVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly severity: 'warn' | 'block'; readonly message: string };

export function parseTrailer(message: string): { readonly ids: readonly string[] } {
  const match = TRAILER_RE.exec(message);
  if (!match) return { ids: [] };
  const line = match[1] ?? '';
  const ids = new Set<string>();
  for (const m of line.matchAll(ID_RE)) {
    if (m[1]) ids.add(m[1]);
  }
  return { ids: [...ids] };
}

export function validateCommitMessage(options: {
  readonly cwd: string;
  readonly message: string;
  readonly config: Config;
  readonly activeSpecIds?: readonly string[];
}): TrailerVerdict {
  const { message, config } = options;
  const { ids } = parseTrailer(message);
  const strictness = config.strictness;

  // If there is no active spec in the repo, there is nothing to require.
  const specIds =
    options.activeSpecIds ??
    listSpecs(options.cwd)
      .filter((s) => s.status === 'approved' || s.status === 'implemented')
      .map((s) => s.specId);
  if (specIds.length === 0) return { ok: true };

  if (ids.length === 0) {
    if (strictness === 'advisory')
      return {
        ok: false,
        severity: 'warn',
        message: "Missing 'Spec: REQ-xxx' trailer (advisory).",
      };
    return {
      ok: false,
      severity: 'block',
      message:
        "Missing 'Spec: REQ-xxx' trailer. Add e.g. `Spec: REQ-001` to the commit message (strictness >= standard, run.md §9.4).",
    };
  }

  return { ok: true };
}

/** Convenience helper used by the commit-msg shim: reads the file, validates,
 *  and returns the appropriate exit code (0 ok, 1 blocked, 0+warn for advisory). */
export function checkCommitMessageFile(cwd: string, msgPath: string, config: Config): number {
  const message = readFileSync(msgPath, 'utf8');
  const verdict = validateCommitMessage({ cwd, message, config });
  if (verdict.ok) return 0;
  if (verdict.severity === 'block') {
    process.stderr.write(`SpecGate: ${verdict.message}\n`);
    return 1;
  }
  process.stderr.write(`SpecGate (warn): ${verdict.message}\n`);
  return 0;
}
