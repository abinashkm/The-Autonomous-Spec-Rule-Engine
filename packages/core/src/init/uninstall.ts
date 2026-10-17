import {
  existsSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { run } from '../subprocess/run.js';
import { removeManagedBlock } from '../managed-block/writer.js';

/**
 * `specgate uninstall` — undo everything `init` touched.
 * Source of truth: run.md §8 CLI, §24 Distribution.
 *
 * Removes:
 *   - `.specgate/hooks/` (if we installed shims there)
 *   - `git config core.hooksPath` (only when it currently points to `.specgate/hooks`)
 *   - Managed blocks in AGENTS.md and side-car files (CLAUDE.md, .cursor/rules/specgate.mdc,
 *     .github/copilot-instructions.md, GEMINI.md) when present
 *   - .github/workflows/specgate.yml (if the user kept the default name)
 *   - `.specgate/` directory (gated by `purge: true`)
 *
 * The function returns a per-target action log so the CLI (and tests) can
 * verify behaviour. **Never deletes user-authored files**; only strips
 * managed-block regions.
 */

export interface UninstallOptions {
  readonly cwd: string;
  readonly purge?: boolean; // when true, also delete .specgate/
  readonly skipGitConfig?: boolean;
}

export type UninstallActionKind = 'removed' | 'cleared' | 'absent' | 'skipped' | 'kept';

export interface UninstallAction {
  readonly target: string;
  readonly action: UninstallActionKind;
  readonly note?: string;
}

export interface UninstallResult {
  readonly cwd: string;
  readonly actions: readonly UninstallAction[];
}

const MANAGED_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.cursor/rules/specgate.mdc',
  '.github/copilot-instructions.md',
  'GEMINI.md',
];

const CI_FILES = ['.github/workflows/specgate.yml'];

export async function runUninstall(options: UninstallOptions): Promise<UninstallResult> {
  const cwd = resolve(options.cwd);
  const actions: UninstallAction[] = [];

  // 1. Strip managed blocks in shared files (keeps user content).
  for (const rel of MANAGED_FILES) {
    const abs = join(cwd, rel);
    if (!existsSync(abs)) {
      actions.push({ target: rel, action: 'absent' });
      continue;
    }
    const before = readFileSync(abs, 'utf8');
    const r = removeManagedBlock(abs);
    if (r === 'absent') {
      actions.push({ target: rel, action: 'kept', note: 'no managed block present' });
      continue;
    }
    const after = readFileSync(abs, 'utf8');
    // When the file is now empty, remove it so `diff` against pre-init is clean.
    if (after.trim().length === 0 && before.length > 0) {
      try {
        unlinkSync(abs);
      } catch {
        /* ignore */
      }
      actions.push({ target: rel, action: 'removed', note: 'file was only our managed block' });
    } else {
      actions.push({ target: rel, action: 'cleared' });
    }
    // After we remove a side-car's directory contents, prune empty parent dirs
    // (e.g. .cursor/rules/) if nothing else is in them.
    pruneEmptyDirs(cwd, dirname(rel));
  }

  // 2. Remove the CI file we wrote.
  for (const rel of CI_FILES) {
    const abs = join(cwd, rel);
    if (!existsSync(abs)) {
      actions.push({ target: rel, action: 'absent' });
      continue;
    }
    try {
      unlinkSync(abs);
      actions.push({ target: rel, action: 'removed' });
      pruneEmptyDirs(cwd, dirname(rel));
    } catch (err) {
      actions.push({ target: rel, action: 'skipped', note: (err as Error).message });
    }
  }

  // 3. Reset `git config core.hooksPath` if it points at our hooks dir, then
  //    delete `.specgate/hooks/` + `.claude/settings.json` managed block.
  const hooksDir = join(cwd, '.specgate', 'hooks');
  if (existsSync(hooksDir)) {
    try {
      rmSync(hooksDir, { recursive: true, force: true });
      actions.push({ target: '.specgate/hooks/', action: 'removed' });
    } catch (err) {
      actions.push({ target: '.specgate/hooks/', action: 'skipped', note: (err as Error).message });
    }
  } else {
    actions.push({ target: '.specgate/hooks/', action: 'absent' });
  }

  if (!options.skipGitConfig) {
    try {
      const got = await run('git', ['config', '--get', 'core.hooksPath'], {
        cwd,
        timeoutMs: 5_000,
      });
      if (got.exitCode === 0 && got.stdout.trim().endsWith('.specgate/hooks')) {
        const unset = await run('git', ['config', '--unset', 'core.hooksPath'], {
          cwd,
          timeoutMs: 5_000,
        });
        actions.push({
          target: 'git config core.hooksPath',
          action: unset.exitCode === 0 ? 'cleared' : 'skipped',
          ...(unset.exitCode === 0 ? {} : { note: `exit ${unset.exitCode}` }),
        });
      } else {
        actions.push({
          target: 'git config core.hooksPath',
          action: 'kept',
          note: 'not managed by SpecGate',
        });
      }
    } catch (err) {
      actions.push({
        target: 'git config core.hooksPath',
        action: 'skipped',
        note: (err as Error).message,
      });
    }
  }

  // 4. Claude Code settings fragment.
  const ccSettings = join(cwd, '.claude', 'settings.json');
  if (existsSync(ccSettings)) {
    try {
      const parsed = JSON.parse(readFileSync(ccSettings, 'utf8')) as {
        hooks?: Record<string, Array<Record<string, unknown>>>;
      };
      if (parsed.hooks) {
        for (const name of Object.keys(parsed.hooks)) {
          parsed.hooks[name] = (parsed.hooks[name] ?? []).filter(
            (entry) => !isSpecgateManaged(entry),
          );
          if (parsed.hooks[name].length === 0) delete parsed.hooks[name];
        }
      }
      const hasRemainingHooks = parsed.hooks && Object.keys(parsed.hooks).length > 0;
      if (!hasRemainingHooks && Object.keys(parsed).length <= 1) {
        unlinkSync(ccSettings);
        pruneEmptyDirs(cwd, '.claude');
        actions.push({ target: '.claude/settings.json', action: 'removed' });
      } else {
        writeFileSync(ccSettings, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
        actions.push({ target: '.claude/settings.json', action: 'cleared' });
      }
    } catch (err) {
      actions.push({
        target: '.claude/settings.json',
        action: 'skipped',
        note: (err as Error).message,
      });
    }
  }

  // 5. Optional purge of the whole .specgate directory.
  if (options.purge) {
    const sgDir = join(cwd, '.specgate');
    if (existsSync(sgDir)) {
      try {
        rmSync(sgDir, { recursive: true, force: true });
        actions.push({ target: '.specgate/', action: 'removed', note: 'purge=true' });
      } catch (err) {
        actions.push({ target: '.specgate/', action: 'skipped', note: (err as Error).message });
      }
    }
  } else {
    // Clean up anything SpecGate wrote under .specgate that isn't user content.
    for (const rel of [
      '.specgate/stack.json',
      '.specgate/state.json',
      '.specgate/reports',
      '.specgate/.gitignore',
    ]) {
      const abs = join(cwd, rel);
      if (!existsSync(abs)) continue;
      try {
        rmSync(abs, { recursive: true, force: true });
        actions.push({ target: rel, action: 'removed' });
      } catch (err) {
        actions.push({ target: rel, action: 'skipped', note: (err as Error).message });
      }
    }
    // config.yaml + specs/ stay — user may want to keep the spec work.
    const sgDir = join(cwd, '.specgate');
    if (existsSync(sgDir)) {
      // Prune .specgate/ ONLY when nothing is left in it (e.g. config.yaml was never written).
      pruneEmptyDirs(cwd, '.specgate');
    }
  }

  return { cwd, actions };
}

function isSpecgateManaged(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as { hooks?: Array<Record<string, unknown>> };
  const hs = e.hooks ?? [];
  return hs.some((h) => h && typeof h === 'object' && h['_specgateManaged'] === true);
}

/** Remove `relDir` under cwd if it exists and is empty; prune parents too. */
function pruneEmptyDirs(cwd: string, relDir: string): void {
  if (!relDir || relDir === '.' || relDir === '/') return;
  const abs = join(cwd, relDir);
  if (!existsSync(abs)) return;
  try {
    const s = statSync(abs);
    if (!s.isDirectory()) return;
    const entries = readdirSync(abs);
    if (entries.length > 0) return;
    rmSync(abs, { recursive: false });
    pruneEmptyDirs(cwd, dirname(relDir));
  } catch {
    /* ignore */
  }
}
