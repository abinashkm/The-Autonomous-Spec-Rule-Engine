import type { GateResult } from '../schemas/gate-result.js';

/**
 * Stable JSON output for `GateResult[]`.
 * Source of truth: run.md §5.8 ("stable JSON (sorted keys)").
 *
 * Determinism is important: CI reporters and the diff-fail logic in M4+ rely
 * on the output being byte-identical across runs of the same inputs.
 */

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function renderJsonReport(results: readonly GateResult[]): string {
  // Omit duration (which is per-run noise); callers that want it can serialize
  // results directly.
  const normalised = results.map((r) => ({ ...r, duration_ms: 0 }));
  return JSON.stringify(sortKeysDeep(normalised), null, 2) + '\n';
}
