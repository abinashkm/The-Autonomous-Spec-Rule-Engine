import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { run } from '../subprocess/run.js';
import { detectHookManager, type HookManager } from './detect.js';
import { writeManagedBlock, readManagedBlock } from '../managed-block/writer.js';

/**
 * Git-hook installer.
 * Source of truth: run.md §9.4 + ADR-012.
 *
 * Policy:
 *   1. If a hook manager is already present, APPEND a step there via a
 *      managed-block edit; never clobber the file.
 *   2. If none → set `git config core.hooksPath .specgate/hooks` and drop a
 *      Node-based pre-commit shim. The shim WARN-AND-SKIPS if `specgate` is
 *      missing (ADR-012: CI is the backstop).
 *   3. commit-msg hook ships alongside the pre-commit hook; it checks the
 *      `Spec: REQ-...` trailer when strictness >= standard and there is an
 *      active spec. (Skipping check for presence is handled in-shim.)
 */

export const HOOKS_RELDIR = '.specgate/hooks';
export const PRE_COMMIT_FILE = 'pre-commit';
export const COMMIT_MSG_FILE = 'commit-msg';

export interface InstallHooksOptions {
  readonly cwd: string;
  /** When true, do not shell out to `git config`; useful for pure unit tests. */
  readonly skipGitConfig?: boolean;
}

export interface InstallHooksAction {
  readonly target: string;
  readonly action: 'created' | 'replaced' | 'appended' | 'unchanged' | 'skipped';
  readonly note?: string;
}

export interface InstallHooksResult {
  readonly cwd: string;
  readonly manager: HookManager;
  readonly actions: readonly InstallHooksAction[];
}

/** Shim body for `.specgate/hooks/pre-commit`. */
const PRE_COMMIT_SHIM = `#!/usr/bin/env node
// SpecGate pre-commit shim. ADR-012: warn-and-skip if specgate is missing.
// This file is managed by SpecGate — do not edit by hand.
"use strict";
const { spawnSync } = require("node:child_process");
const r = spawnSync("specgate", ["check", "--staged"], {
  stdio: "inherit",
  shell: false,
});
if (r.error && r.error.code === "ENOENT") {
  console.warn("SpecGate: 'specgate' not on PATH — skipping pre-commit check.");
  console.warn("SpecGate: install SpecGate or run 'specgate doctor' to diagnose.");
  process.exit(0);
}
process.exit(r.status == null ? 1 : r.status);
`;

/** Shim body for `.specgate/hooks/commit-msg`. The real trailer check runs in
 *  core via `validateTrailer`; the shim reads the file and shells out to a
 *  tiny Node snippet so there is no bash-portability issue (ADR-012). */
const COMMIT_MSG_SHIM = `#!/usr/bin/env node
// SpecGate commit-msg shim. Blocks commits missing a 'Spec: REQ-xxx' trailer
// when strictness >= standard and an active spec exists.
"use strict";
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const msgPath = process.argv[2];
if (!msgPath || !fs.existsSync(msgPath)) process.exit(0);
const r = spawnSync("specgate", ["_commit-msg", msgPath], {
  stdio: "inherit",
  shell: false,
});
if (r.error && r.error.code === "ENOENT") {
  console.warn("SpecGate: 'specgate' not on PATH — skipping commit-msg check.");
  process.exit(0);
}
process.exit(r.status == null ? 1 : r.status);
`;

/** Snippet injected into managed blocks of husky / lefthook / pre-commit configs. */
const INTEGRATION_SNIPPETS: Record<Exclude<HookManager, 'none'>, string> = {
  husky: 'specgate check --staged',
  // pre-commit (python) expects an `id:` repo entry; local `script` works fine.
  'pre-commit':
    'repos:\n  - repo: local\n    hooks:\n      - id: specgate\n        name: specgate check --staged\n        entry: specgate check --staged\n        language: system\n        pass_filenames: false',
  // lefthook: a pre-commit command block.
  lefthook: 'pre-commit:\n  commands:\n    specgate:\n      run: specgate check --staged',
};

/**
 * Write both hook shims under `.specgate/hooks/` and set `core.hooksPath`.
 * Returns the file paths of what was written.
 */
async function writeOwnShims(cwd: string, skipGitConfig: boolean): Promise<InstallHooksAction[]> {
  const dir = resolve(cwd, HOOKS_RELDIR);
  mkdirSync(dir, { recursive: true });

  const actions: InstallHooksAction[] = [];

  const preCommit = join(dir, PRE_COMMIT_FILE);
  const commitMsg = join(dir, COMMIT_MSG_FILE);

  const writeIdempotent = (path: string, body: string, rel: string): InstallHooksAction => {
    if (existsSync(path)) {
      const current = readFileSync(path, 'utf8');
      if (current === body) return { target: rel, action: 'unchanged' };
      writeFileSync(path, body, 'utf8');
      maybeChmod(path);
      return { target: rel, action: 'replaced' };
    }
    writeFileSync(path, body, 'utf8');
    maybeChmod(path);
    return { target: rel, action: 'created' };
  };

  actions.push(writeIdempotent(preCommit, PRE_COMMIT_SHIM, `${HOOKS_RELDIR}/${PRE_COMMIT_FILE}`));
  actions.push(writeIdempotent(commitMsg, COMMIT_MSG_SHIM, `${HOOKS_RELDIR}/${COMMIT_MSG_FILE}`));

  if (!skipGitConfig) {
    try {
      const r = await run('git', ['config', 'core.hooksPath', HOOKS_RELDIR], {
        cwd,
        timeoutMs: 5_000,
      });
      actions.push({
        target: 'git config core.hooksPath',
        action: r.exitCode === 0 ? 'created' : 'skipped',
        ...(r.exitCode === 0
          ? {}
          : { note: `git exited ${r.exitCode}: ${r.stderr.slice(0, 120)}` }),
      });
    } catch (err) {
      actions.push({
        target: 'git config core.hooksPath',
        action: 'skipped',
        note: `git not available: ${(err as Error).message}`,
      });
    }
  } else {
    actions.push({
      target: 'git config core.hooksPath',
      action: 'skipped',
      note: 'skipGitConfig=true',
    });
  }
  return actions;
}

function maybeChmod(path: string): void {
  if (process.platform === 'win32') return;
  try {
    const s = statSync(path);
    // 0o755
    chmodSync(path, s.mode | 0o111);
  } catch {
    /* ignore */
  }
}

/**
 * Integrate with an existing hook manager by writing a managed block in the
 * manager's config file. The user may have other steps around our block.
 */
function integrateWithManager(
  cwd: string,
  manager: Exclude<HookManager, 'none'>,
): InstallHooksAction[] {
  const actions: InstallHooksAction[] = [];
  const snippet = INTEGRATION_SNIPPETS[manager];

  switch (manager) {
    case 'husky': {
      // Husky stores each hook in its own executable file under .husky/.
      const target = join(cwd, '.husky', 'pre-commit');
      mkdirSync(join(cwd, '.husky'), { recursive: true });
      const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
      // Keep the existing content; append our managed block.
      if (!current.includes('<!-- specgate:begin -->')) {
        const next =
          (current.length === 0
            ? '#!/usr/bin/env sh\n'
            : current.endsWith('\n')
              ? current
              : current + '\n') + '\n';
        writeFileSync(target, next, 'utf8');
      }
      // writeManagedBlock preserves anything outside the markers.
      const writeRes = writeManagedBlock(target, snippet, { createIfMissing: true });
      maybeChmod(target);
      actions.push({ target: '.husky/pre-commit', action: writeRes.action });
      return actions;
    }
    case 'pre-commit': {
      // Append a managed block to .pre-commit-config.yaml.
      const target = existsSync(join(cwd, '.pre-commit-config.yaml'))
        ? join(cwd, '.pre-commit-config.yaml')
        : join(cwd, '.pre-commit-config.yml');
      const writeRes = writeManagedBlock(target, snippet, { createIfMissing: true });
      actions.push({
        target: `.pre-commit-config.y${target.endsWith('yaml') ? 'aml' : 'ml'}`,
        action: writeRes.action,
      });
      return actions;
    }
    case 'lefthook': {
      const target = existsSync(join(cwd, 'lefthook.yml'))
        ? join(cwd, 'lefthook.yml')
        : join(cwd, 'lefthook.yaml');
      const writeRes = writeManagedBlock(target, snippet, { createIfMissing: true });
      actions.push({
        target: `lefthook.y${target.endsWith('yaml') ? 'aml' : 'ml'}`,
        action: writeRes.action,
      });
      return actions;
    }
  }
}

export async function installHooks(options: InstallHooksOptions): Promise<InstallHooksResult> {
  const cwd = resolve(options.cwd);
  const { manager } = detectHookManager(cwd);

  const actions: InstallHooksAction[] =
    manager === 'none'
      ? await writeOwnShims(cwd, options.skipGitConfig ?? false)
      : integrateWithManager(cwd, manager);

  return { cwd, manager, actions };
}

export const _INTERNAL = { PRE_COMMIT_SHIM, COMMIT_MSG_SHIM, INTEGRATION_SNIPPETS };

/** Exposed for tests. */
export { readManagedBlock as _readManagedBlockForTests };
