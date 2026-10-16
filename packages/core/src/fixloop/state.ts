import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { z } from 'zod';
import type { GateResult, Finding } from '../schemas/gate-result.js';

/**
 * Fix-loop state.
 * Source of truth: run.md §13.1.
 *
 * Persisted at `.specgate/state.json` (gitignored per §6). Keeps attempt
 * counters and a hash of the last blocking findings so we can detect
 * "no progress" between attempts.
 */

export const STATE_RELPATH = '.specgate/state.json';

export const FixLoopState = z
  .object({
    spec_id: z.string().optional(),
    task_id: z.string().optional(),
    attempt: z.number().int().min(0).default(0),
    lastFindingsHash: z.string().nullable().default(null),
    updatedAt: z.string().optional(),
  })
  .strict();
export type FixLoopState = z.infer<typeof FixLoopState>;

export function defaultState(): FixLoopState {
  return FixLoopState.parse({
    attempt: 0,
    lastFindingsHash: null,
  });
}

export function readState(cwd: string): FixLoopState {
  const abs = resolve(cwd, STATE_RELPATH);
  if (!existsSync(abs)) return defaultState();
  try {
    const parsed = JSON.parse(readFileSync(abs, 'utf8')) as unknown;
    return FixLoopState.parse(parsed);
  } catch {
    // Corruption → reset to defaults with a warning on stderr (never throws).
    process.stderr.write(`SpecGate: .specgate/state.json was corrupt; resetting to defaults.\n`);
    const fresh = defaultState();
    writeState(cwd, fresh);
    return fresh;
  }
}

export function writeState(cwd: string, state: FixLoopState): string {
  const abs = resolve(cwd, STATE_RELPATH);
  mkdirSync(dirname(abs), { recursive: true });
  const body = JSON.stringify(
    { ...state, updatedAt: state.updatedAt ?? new Date().toISOString() },
    null,
    2,
  );
  writeFileSync(abs, body + '\n', 'utf8');
  return abs;
}

/**
 * Compute a deterministic hash of the blocking findings in a check result.
 * Used by `shouldStop` to detect "no progress between attempts" (§13.1 rule 5).
 */
export function hashBlockingFindings(results: readonly GateResult[]): string {
  const blocking: Array<Pick<Finding, 'id' | 'file' | 'line' | 'message'>> = [];
  for (const r of results) {
    if (!r.blocking) continue;
    if (r.status !== 'fail' && r.status !== 'error') continue;
    for (const f of r.findings) {
      blocking.push({ id: f.id, file: f.file, line: f.line, message: f.message });
    }
  }
  // Sort for determinism.
  blocking.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if ((a.line ?? 0) !== (b.line ?? 0)) return (a.line ?? 0) - (b.line ?? 0);
    return a.id.localeCompare(b.id);
  });
  return createHash('sha256').update(JSON.stringify(blocking)).digest('hex');
}

/**
 * Decide whether to stop the fix-loop.
 *
 * Stop reasons (§13.1 rule 5):
 *   `max-attempts`  — `attempt >= maxAttempts`
 *   `no-progress`   — new findings hash equals the previous one
 *   `success`       — zero blocking findings
 */
export type StopReason = 'max-attempts' | 'no-progress' | 'success';

export interface StopVerdict {
  readonly stop: boolean;
  readonly reason: StopReason | null;
  readonly nextState: FixLoopState;
}

export function shouldStop(options: {
  readonly state: FixLoopState;
  readonly maxAttempts: number;
  readonly results: readonly GateResult[];
  readonly now?: () => Date;
}): StopVerdict {
  const { state, maxAttempts, results } = options;
  const nextHash = hashBlockingFindings(results);
  const hasBlocking = results.some(
    (r) => r.blocking && (r.status === 'fail' || r.status === 'error'),
  );
  const now = (options.now ?? (() => new Date()))();

  // Success — nothing blocking left.
  if (!hasBlocking) {
    const next = FixLoopState.parse({
      ...state,
      attempt: state.attempt + 1,
      lastFindingsHash: nextHash,
      updatedAt: now.toISOString(),
    });
    return { stop: true, reason: 'success', nextState: next };
  }

  // No-progress — same hash as last time.
  if (state.lastFindingsHash !== null && state.lastFindingsHash === nextHash) {
    const next = FixLoopState.parse({
      ...state,
      attempt: state.attempt + 1,
      lastFindingsHash: nextHash,
      updatedAt: now.toISOString(),
    });
    return { stop: true, reason: 'no-progress', nextState: next };
  }

  // Max attempts.
  const nextAttempt = state.attempt + 1;
  if (nextAttempt >= maxAttempts) {
    const next = FixLoopState.parse({
      ...state,
      attempt: nextAttempt,
      lastFindingsHash: nextHash,
      updatedAt: now.toISOString(),
    });
    return { stop: true, reason: 'max-attempts', nextState: next };
  }

  // Keep going — bump the counter + hash.
  const next = FixLoopState.parse({
    ...state,
    attempt: nextAttempt,
    lastFindingsHash: nextHash,
    updatedAt: now.toISOString(),
  });
  return { stop: false, reason: null, nextState: next };
}

/** Reset the loop (used by `specgate check` when there is nothing blocking). */
export function resetState(cwd: string, patch?: Partial<FixLoopState>): FixLoopState {
  const fresh = FixLoopState.parse({ ...defaultState(), ...(patch ?? {}) });
  writeState(cwd, fresh);
  return fresh;
}

/** Convenience path used by tests. */
export const stateFilePath = (cwd: string): string => join(resolve(cwd), STATE_RELPATH);
