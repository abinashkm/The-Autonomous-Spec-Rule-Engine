import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Detect which git-hook manager (if any) the repo already uses.
 * Source of truth: run.md §9.4 + ADR-012 — SpecGate must *integrate* with
 * existing tools, not clobber them.
 *
 * Priority order (first match wins):
 *   husky       — `.husky/` directory present
 *   pre-commit  — `.pre-commit-config.yaml` or `.yml` present
 *   lefthook    — `lefthook.yml` or `lefthook.yaml` present
 *   none        — fall back to `core.hooksPath` + Node shim (M4.A.2)
 */

export type HookManager = 'husky' | 'pre-commit' | 'lefthook' | 'none';

export interface HookDetectResult {
  readonly manager: HookManager;
  readonly configPath: string | null;
}

export function detectHookManager(cwd: string): HookDetectResult {
  const root = resolve(cwd);

  // husky: `.husky/` directory with a `_` subdir, or `husky` in package.json scripts.
  const huskyDir = resolve(root, '.husky');
  if (existsSync(huskyDir)) return { manager: 'husky', configPath: huskyDir };

  // Also check package.json for husky devDep as a secondary signal — the dir
  // isn't always created until `husky install` runs the first time.
  const pkgJson = resolve(root, 'package.json');
  if (existsSync(pkgJson)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJson, 'utf8')) as {
        devDependencies?: Record<string, string>;
        dependencies?: Record<string, string>;
      };
      if (pkg.devDependencies?.husky || pkg.dependencies?.husky) {
        return { manager: 'husky', configPath: huskyDir };
      }
    } catch {
      // ignore malformed package.json
    }
  }

  for (const name of ['.pre-commit-config.yaml', '.pre-commit-config.yml']) {
    const p = resolve(root, name);
    if (existsSync(p)) return { manager: 'pre-commit', configPath: p };
  }

  for (const name of ['lefthook.yml', 'lefthook.yaml']) {
    const p = resolve(root, name);
    if (existsSync(p)) return { manager: 'lefthook', configPath: p };
  }

  return { manager: 'none', configPath: null };
}
