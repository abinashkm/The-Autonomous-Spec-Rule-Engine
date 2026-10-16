import type { Gate, GateAvailability, RunContext } from './types.js';
import type { GateResult } from '../schemas/gate-result.js';
import { isBlocking } from './strictness.js';

/**
 * Gate runner.
 * Source of truth: run.md §10.3.
 *
 * Behaviour:
 *   - All gates run in parallel.
 *   - A gate that throws returns `status: 'error'` with the message in
 *     `error_message` (never bubbles up — `runGates` must always return a
 *     result array).
 *   - A gate that times out individually returns `status: 'error'` via the
 *     runner's wrapper timeout (`perGateTimeoutMs`).
 *   - A gate reporting `detect().available === false` returns `status: 'skipped'`
 *     with the detect reason copied into `skipped_reason`. Never silently pass.
 *   - `blocking` field is derived from `strictness`:
 *     `blocking = strictness >= gate.defaultBlockingAt` (unless the gate's own
 *     config overrides `blocking_at` in `config.gates.<id>`).
 */

export interface RunGatesOptions {
  readonly perGateTimeoutMs?: number;
}

const DEFAULT_PER_GATE_TIMEOUT = 120_000;

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((resolveT) => {
    timer = setTimeout(() => resolveT(onTimeout()), ms);
  });
  return Promise.race([
    p.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timeoutPromise,
  ]);
}

function errorResult(
  gate: Gate,
  blocking: boolean,
  message: string,
  durationMs: number,
): GateResult {
  return {
    gate: gate.id,
    status: 'error',
    blocking,
    duration_ms: durationMs,
    findings: [],
    tool: { name: gate.id, version: null },
    error_message: message,
  };
}

function skippedResult(
  gate: Gate,
  blocking: boolean,
  reason: string,
  durationMs: number,
): GateResult {
  return {
    gate: gate.id,
    status: 'skipped',
    blocking,
    duration_ms: durationMs,
    findings: [],
    tool: { name: gate.id, version: null },
    skipped_reason: reason,
  };
}

export async function runOneGate(
  gate: Gate,
  ctx: RunContext,
  options: RunGatesOptions = {},
): Promise<GateResult> {
  const perGate = options.perGateTimeoutMs ?? DEFAULT_PER_GATE_TIMEOUT;
  const gateConfig = ctx.config.gates[gate.id];
  const blockingAt = gateConfig?.blocking_at ?? gate.defaultBlockingAt;
  const blocking = isBlocking(ctx.config.strictness, blockingAt);

  const start = Date.now();

  // Honour `enabled: false` in config.
  if (gateConfig && gateConfig.enabled === false) {
    return skippedResult(
      gate,
      blocking,
      gateConfig.reason ?? 'disabled in .specgate/config.yaml',
      Date.now() - start,
    );
  }

  // Detect first. Any detect failure counts as 'skipped' with a reason.
  let avail: GateAvailability;
  try {
    avail = await withTimeout(gate.detect(ctx), perGate, () => ({
      available: false,
      reason: 'detect() timed out',
    }));
  } catch (err) {
    return errorResult(
      gate,
      blocking,
      `detect() threw: ${(err as Error).message}`,
      Date.now() - start,
    );
  }
  if (!avail.available) {
    return skippedResult(gate, blocking, avail.reason, Date.now() - start);
  }

  // Run the gate.
  try {
    const result = await withTimeout(gate.run(ctx), perGate, () =>
      errorResult(gate, blocking, 'run() timed out', Date.now() - start),
    );
    // Normalise blocking + duration regardless of what the gate reported.
    return {
      ...result,
      blocking,
      duration_ms: result.duration_ms ?? Date.now() - start,
    };
  } catch (err) {
    return errorResult(
      gate,
      blocking,
      `run() threw: ${(err as Error).message}`,
      Date.now() - start,
    );
  }
}

export async function runGates(
  gates: readonly Gate[],
  ctx: RunContext,
  options: RunGatesOptions = {},
): Promise<GateResult[]> {
  const results = await Promise.all(gates.map((g) => runOneGate(g, ctx, options)));
  // Deterministic order: by gate id.
  return results.sort((a, b) => a.gate.localeCompare(b.gate));
}
