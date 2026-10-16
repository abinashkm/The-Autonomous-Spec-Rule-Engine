import { resolve } from 'node:path';
import { resolveConfig } from '../config/load.js';
import { detectStackCached } from '../stack/cache.js';
import { runGates } from '../gates/run.js';
import { filesForScope } from '../gates/scope.js';
import { SecretsGate } from '../gates/secrets.js';
import { LintGate } from '../gates/lint.js';
import { TestsGate } from '../gates/tests.js';
import { summarise } from '../report/terminal.js';
import type { Gate, GateScope, RunContext } from '../gates/types.js';
import type { GateResult } from '../schemas/gate-result.js';
import type { Config } from '../schemas/config.js';
import type { StackProfile } from '../schemas/stack-profile.js';

/**
 * `specgate check` orchestration.
 * Source of truth: run.md §8 + §10.
 *
 * Builds the run context, picks which gates to invoke, and returns the
 * normalised `GateResult[]` + a summary. Exit-code logic lives in the CLI
 * adapter because the "core returns data, adapters return exit codes" split
 * from §22 keeps the core unit-testable.
 */

export interface RunCheckOptions {
  readonly cwd: string;
  readonly scope?: GateScope;
  readonly gates?: readonly string[]; // filter — defaults to the built-in trio
  readonly strictnessOverride?: Config['strictness'];
}

export interface RunCheckResult {
  readonly cwd: string;
  readonly scope: GateScope;
  readonly config: Config;
  readonly stack: StackProfile;
  readonly results: readonly GateResult[];
  readonly summary: ReturnType<typeof summarise>;
}

const DEFAULT_GATES: readonly Gate[] = [SecretsGate, LintGate, TestsGate];

function pickGates(filter?: readonly string[]): readonly Gate[] {
  if (!filter || filter.length === 0) return DEFAULT_GATES;
  const set = new Set(filter);
  return DEFAULT_GATES.filter((g) => set.has(g.id));
}

export async function runCheck(options: RunCheckOptions): Promise<RunCheckResult> {
  const cwd = resolve(options.cwd);
  const scope: GateScope = options.scope ?? 'full';

  const config = resolveConfig({
    cwd,
    ...(options.strictnessOverride ? { cliFlags: { strictness: options.strictnessOverride } } : {}),
  });
  const stack = await detectStackCached(cwd, { useCache: true });

  const files = scope === 'full' ? [] : await filesForScope(cwd, scope);

  const ctx: RunContext = { cwd, stack, config, scope, files };

  const gates = pickGates(options.gates);
  const results = await runGates(gates, ctx);
  return {
    cwd,
    scope,
    config,
    stack,
    results,
    summary: summarise(results),
  };
}

/** Exit-code mapping per run.md §8. */
export function exitCodeFor(options: {
  readonly summary: ReturnType<typeof summarise>;
  readonly results: readonly GateResult[];
  readonly failOnWarn?: boolean;
}): number {
  const { summary, results, failOnWarn } = options;
  // 2: tool/config error — any gate errored and was blocking.
  const anyBlockingError = results.some((r) => r.status === 'error' && r.blocking);
  if (anyBlockingError) return 2;
  // 1: blocking failure.
  if (summary.blockingFailures > 0) return 1;
  // 3: warnings-only with --fail-on-warn.
  if (failOnWarn && summary.warn > 0) return 3;
  return 0;
}
