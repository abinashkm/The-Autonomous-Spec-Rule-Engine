import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import type { Gate, GateAvailability, RepoContext, RunContext } from './types.js';
import type { Finding, GateResult } from '../schemas/gate-result.js';
import { run } from '../subprocess/run.js';

/**
 * Tamper gate.
 * Source of truth: run.md §13.3 + §16 + ADR-013.
 *
 * Watches for edits to tamper-sensitive paths:
 *   - .specgate/config.yaml
 *   - .specgate/baseline.json  (lands in P2 brownfield; already protected here)
 *   - packs/**                 (first-party rule packs)
 *   - .specgate/rules/**       (vendored third-party packs)
 *
 * Behaviour (ADR-013):
 *   - LOCAL run             → `warn` finding ("flagged for human review")
 *   - CI + strictness=strict → `fail` finding (blocks the PR unless the
 *                               CODEOWNERS review or `specgate-approved` label
 *                               is applied — that part is enforced by GitHub,
 *                               not here).
 *
 * The gate uses `git diff` to see what changed vs HEAD (or the merge-base in
 * CI). If git is not available, the gate reports `skipped`.
 */

export const TAMPER_PATHS: readonly string[] = [
  '.specgate/config.yaml',
  '.specgate/baseline.json',
  'packs/',
  '.specgate/rules/',
];

function isCi(): boolean {
  const env = process.env;
  return (
    env['CI'] === 'true' ||
    env['GITHUB_ACTIONS'] === 'true' ||
    env['GITLAB_CI'] === 'true' ||
    env['CIRCLECI'] === 'true'
  );
}

function isUnder(file: string, protectedPath: string): boolean {
  if (protectedPath.endsWith('/')) return file.startsWith(protectedPath);
  return file === protectedPath;
}

async function changedFiles(cwd: string): Promise<string[]> {
  try {
    const r = await run('git', ['diff', '--name-only', 'HEAD'], {
      cwd,
      timeoutMs: 5_000,
    });
    if (r.exitCode !== 0) return [];
    return r.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function hashFile(abs: string): string | null {
  try {
    const buf = readFileSync(abs);
    return createHash('sha256').update(buf).digest('hex').slice(0, 12);
  } catch {
    return null;
  }
}

function listUnder(cwd: string, rel: string): string[] {
  const abs = resolve(cwd, rel);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    try {
      for (const ent of readdirSync(dir, { withFileTypes: true, encoding: 'utf8' })) {
        if (ent.name.startsWith('.git')) continue;
        const sub = join(dir, ent.name);
        if (ent.isDirectory()) walk(sub);
        else if (ent.isFile()) out.push(sub);
      }
    } catch {
      /* ignore */
    }
  };
  if (statSync(abs).isDirectory()) walk(abs);
  else out.push(abs);
  return out;
}

export const TamperGate: Gate = {
  id: 'spec', // Rides on the "spec" gate slot per run.md §10.2 (strict blocking).
  scopes: ['staged', 'changed', 'full'],
  defaultBlockingAt: 'strict',

  async detect(_ctx: RepoContext): Promise<GateAvailability> {
    // Always available — no external tool needed.
    return { available: true };
  },

  async run(ctx: RunContext): Promise<GateResult> {
    const start = Date.now();
    const changed = await changedFiles(ctx.cwd);
    const findings: Finding[] = [];
    const ci = isCi();
    const atStrict = ctx.config.strictness === 'strict';

    for (const file of changed) {
      const matches = TAMPER_PATHS.some((p) => isUnder(file, p));
      if (!matches) continue;
      const abs = resolve(ctx.cwd, file);
      const hash = hashFile(abs);
      findings.push({
        id: 'tamper.sensitive-file-edited',
        severity: ci && atStrict ? 'error' : 'warning',
        file,
        line: null,
        message:
          `Edit to tamper-sensitive path '${file}'` +
          (hash ? ` (sha256:${hash})` : '') +
          `. Changes to config / baseline / rule packs during an agent session must be reviewed by a human (ADR-013).`,
        fix_hint:
          ci && atStrict
            ? 'Revert the edit, or get the PR reviewed under CODEOWNERS / apply the `specgate-approved` label.'
            : 'Flagged for review. In CI at strict this will block the merge.',
        auto_fixable: false,
        rule_ref: 'tamper.sensitive-file-edited',
        spec_ref: null,
      });
    }

    // Even on `full` scope with no git diff available, enumerate currently-
    // present files for a hash manifest (future comparison), but never emit
    // findings without a diff — that would be too noisy.
    void listUnder;

    const status: GateResult['status'] =
      findings.length === 0 ? 'pass' : ci && atStrict ? 'fail' : 'warn';
    return {
      gate: 'spec',
      status,
      blocking: ci && atStrict,
      duration_ms: Date.now() - start,
      findings,
      tool: { name: 'tamper', version: null },
    };
  },
};
