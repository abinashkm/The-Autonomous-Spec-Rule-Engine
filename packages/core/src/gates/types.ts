import type { Config, Strictness as StrictnessT, GateId } from '../schemas/config.js';
import type { StackProfile } from '../schemas/stack-profile.js';
import type { GateResult } from '../schemas/gate-result.js';

/**
 * Gate interfaces.
 * Source of truth: run.md §10.1.
 */

export type GateScope = 'staged' | 'changed' | 'full';

export interface RepoContext {
  readonly cwd: string;
  readonly stack: StackProfile;
  readonly config: Config;
}

export interface RunContext extends RepoContext {
  readonly scope: GateScope;
  /** Files to lint/test when `scope` is `staged` or `changed`. Absolute paths. */
  readonly files: readonly string[];
}

export type GateAvailability =
  { readonly available: true } | { readonly available: false; readonly reason: string };

export interface Gate {
  readonly id: GateId;
  readonly scopes: readonly GateScope[];
  readonly defaultBlockingAt: StrictnessT;
  detect(ctx: RepoContext): Promise<GateAvailability>;
  run(ctx: RunContext): Promise<GateResult>;
}

export type { GateId, GateResult };
