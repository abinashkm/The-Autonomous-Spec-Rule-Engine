import { run } from '../subprocess/run.js';

/**
 * Compute files-in-scope using `git diff --name-only`.
 * `staged`  → `--cached HEAD`
 * `changed` → working-tree + staged changes
 * `full`    → empty (gate falls back to its own default scope)
 */

export type GitScope = 'staged' | 'changed';

export async function filesForScope(cwd: string, scope: GitScope): Promise<string[]> {
  const args =
    scope === 'staged' ? ['diff', '--name-only', '--cached'] : ['diff', '--name-only', 'HEAD'];
  try {
    const r = await run('git', args, { cwd, timeoutMs: 10_000 });
    if (r.exitCode !== 0) return [];
    return r.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}
