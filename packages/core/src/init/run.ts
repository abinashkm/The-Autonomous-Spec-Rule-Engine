import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import yaml from 'js-yaml';
import type { Config } from '../schemas/config.js';
import { defaultConfig } from '../config/defaults.js';
import { configPath } from '../config/load.js';
import { detectStackCached } from '../stack/cache.js';
import { renderAgentsBlock } from '../agents-md/render.js';
import { writeManagedBlock } from '../managed-block/writer.js';
import type { StackProfile } from '../schemas/stack-profile.js';

/**
 * `specgate init` business logic — adapter-free (run.md §22.3).
 * Source of truth: run.md §9.1 (AGENTS.md), §6 (on-disk layout).
 *
 * The function is idempotent: running it twice produces byte-identical output
 * (DoD for M1.F.2).
 *
 * What `init` does, in order:
 *   1. Detect the stack (and write/refresh `.specgate/stack.json`).
 *   2. Resolve the effective config (defaults for now; preset lands in M8).
 *   3. Write `.specgate/config.yaml` if missing (never overwrite — the user's
 *      edits are hers; use `specgate update` for migrations).
 *   4. Write the managed block in AGENTS.md.
 *   5. Write `.specgate/.gitignore` for `reports/` and `state.json` (§6).
 *   6. Return a summary the caller can print.
 */

export interface InitOptions {
  readonly cwd: string;
  /** When true, do not re-write existing files (default: idempotent writer handles this). */
  readonly dryRun?: boolean;
}

export interface InitResult {
  readonly cwd: string;
  readonly stack: StackProfile;
  readonly config: Config;
  readonly actions: readonly InitAction[];
  readonly nextSteps: readonly string[];
}

export interface InitAction {
  readonly target: string;
  readonly action: 'created' | 'replaced' | 'appended' | 'unchanged' | 'skipped';
  readonly note?: string;
}

const AGENTS_MD_FILENAME = 'AGENTS.md';

export async function runInit(options: InitOptions): Promise<InitResult> {
  const cwd = resolve(options.cwd);
  const actions: InitAction[] = [];

  // 1. Detect stack. `useCache: true` keeps subsequent `init` calls byte-identical
  //    (idempotency DoD, M1.F.2) by reusing a fresh `.specgate/stack.json` if
  //    no indicator file has been touched since it was written.
  const stack = await detectStackCached(cwd, { useCache: true });
  actions.push({ target: '.specgate/stack.json', action: 'created' });

  // 2. Resolve config (defaults only in M1; presets come in M8).
  const config = defaultConfig();

  // 3. Write .specgate/config.yaml if missing.
  const cfgPath = configPath(cwd);
  if (!existsSync(cfgPath)) {
    mkdirSync(join(cwd, '.specgate'), { recursive: true });
    writeFileSync(cfgPath, yaml.dump(config, { lineWidth: 100, sortKeys: true }), 'utf8');
    actions.push({ target: '.specgate/config.yaml', action: 'created' });
  } else {
    actions.push({
      target: '.specgate/config.yaml',
      action: 'skipped',
      note: 'already exists — use `specgate update` to migrate',
    });
  }

  // 4. Write the managed block into AGENTS.md.
  const agentsPath = join(cwd, AGENTS_MD_FILENAME);
  const blockBody = renderAgentsBlock(stack, config);
  const writeRes = writeManagedBlock(agentsPath, blockBody, { createIfMissing: true });
  actions.push({ target: AGENTS_MD_FILENAME, action: writeRes.action });

  // 5. Write .specgate/.gitignore (reports/ + state.json), only if absent.
  const gitignorePath = join(cwd, '.specgate', '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, ['reports/', 'state.json', ''].join('\n'), 'utf8');
    actions.push({ target: '.specgate/.gitignore', action: 'created' });
  } else {
    actions.push({ target: '.specgate/.gitignore', action: 'skipped', note: 'already present' });
  }

  const nextSteps = [
    `Review AGENTS.md — the managed block tells your agent how to work with ${config.strictness} strictness.`,
    'Run `specgate spec new` to describe your first feature (lands in M2).',
    'Run `specgate check` to see which gates are available on this machine (lands in M3).',
  ];

  return {
    cwd,
    stack,
    config,
    actions,
    nextSteps,
  };
}
