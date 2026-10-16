import { resolve } from 'node:path';
import type { Gate, GateAvailability, RepoContext, RunContext } from './types.js';
import type { Finding, GateResult } from '../schemas/gate-result.js';
import { resolveBinary, run } from '../subprocess/run.js';

/**
 * Lint gate.
 * Source of truth: run.md §10.2.
 *
 * Auto-detect order (first match wins):
 *   1. eslint      — stack.linters contains 'eslint' OR package.json present
 *   2. ruff        — stack.linters contains 'ruff' OR pyproject.toml / ruff.toml
 *   3. golangci-lint — go.mod + .golangci.{yml,yaml}
 *
 * The CLI invocation is pure argv (§22.7). Normaliser functions are pure and
 * exported so recorded-output tests can run without the tool installed.
 */

type Linter = 'eslint' | 'ruff' | 'golangci-lint';

export function pickLinter(ctx: RepoContext): Linter | null {
  const linters = new Set(ctx.stack.linters.values);
  const langs = new Set(ctx.stack.languages.values);
  if (linters.has('eslint')) return 'eslint';
  if (linters.has('ruff')) return 'ruff';
  if (linters.has('golangci-lint')) return 'golangci-lint';
  // Fallbacks based on language presence.
  if (langs.has('typescript') || langs.has('javascript')) return 'eslint';
  if (langs.has('python')) return 'ruff';
  if (langs.has('go')) return 'golangci-lint';
  return null;
}

/* ---------------------------- normalisers ----------------------------- */

interface EslintResult {
  readonly filePath: string;
  readonly messages: readonly {
    readonly ruleId: string | null;
    readonly severity: 1 | 2;
    readonly message: string;
    readonly line: number;
    readonly column: number;
    readonly fix?: unknown;
  }[];
}

export function normaliseEslintOutput(json: unknown): Finding[] {
  if (!Array.isArray(json)) return [];
  const out: Finding[] = [];
  for (const file of json as readonly EslintResult[]) {
    if (!file || typeof file !== 'object') continue;
    for (const msg of file.messages ?? []) {
      out.push({
        id: `eslint.${msg.ruleId ?? 'unknown'}`,
        severity: msg.severity === 2 ? 'error' : 'warning',
        file: file.filePath,
        line: Number.isFinite(msg.line) ? msg.line : null,
        message: msg.message,
        fix_hint:
          msg.fix === undefined
            ? 'Follow the rule above.'
            : 'Run `eslint --fix` to apply the auto-fix.',
        auto_fixable: msg.fix !== undefined,
        rule_ref: msg.ruleId ?? null,
        spec_ref: null,
      });
    }
  }
  return sortFindings(out);
}

interface RuffMessage {
  readonly filename: string;
  readonly code: string;
  readonly message: string;
  readonly location: { readonly row: number; readonly column: number };
  readonly fix?: unknown;
}

export function normaliseRuffOutput(json: unknown): Finding[] {
  if (!Array.isArray(json)) return [];
  const out: Finding[] = [];
  for (const m of json as readonly RuffMessage[]) {
    if (!m || typeof m !== 'object') continue;
    out.push({
      id: `ruff.${m.code ?? 'unknown'}`,
      severity: 'warning',
      file: m.filename ?? '',
      line: m.location?.row ?? null,
      message: m.message ?? '',
      fix_hint:
        m.fix === undefined ? 'See https://docs.astral.sh/ruff/rules/' : 'Run `ruff check --fix`.',
      auto_fixable: m.fix !== undefined && m.fix !== null,
      rule_ref: m.code ?? null,
      spec_ref: null,
    });
  }
  return sortFindings(out);
}

interface GolangciIssue {
  readonly FromLinter: string;
  readonly Text: string;
  readonly Pos: { readonly Filename: string; readonly Line: number };
}

export function normaliseGolangciOutput(json: unknown): Finding[] {
  if (!json || typeof json !== 'object') return [];
  const issues = (json as { Issues?: readonly GolangciIssue[] }).Issues;
  if (!Array.isArray(issues)) return [];
  const out: Finding[] = [];
  for (const i of issues) {
    out.push({
      id: `golangci.${i.FromLinter ?? 'unknown'}`,
      severity: 'warning',
      file: i.Pos?.Filename ?? '',
      line: i.Pos?.Line ?? null,
      message: i.Text ?? '',
      fix_hint: 'See the linter docs for this rule.',
      auto_fixable: false,
      rule_ref: i.FromLinter ?? null,
      spec_ref: null,
    });
  }
  return sortFindings(out);
}

function sortFindings(fs: Finding[]): Finding[] {
  return [...fs].sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if ((a.line ?? 0) !== (b.line ?? 0)) return (a.line ?? 0) - (b.line ?? 0);
    return a.id.localeCompare(b.id);
  });
}

/* ----------------------------- gate impl ------------------------------ */

export const LintGate: Gate = {
  id: 'lint',
  scopes: ['changed', 'staged', 'full'],
  defaultBlockingAt: 'standard',

  async detect(ctx: RepoContext): Promise<GateAvailability> {
    const linter = pickLinter(ctx);
    if (!linter) {
      return { available: false, reason: 'No supported linter detected for this stack.' };
    }
    try {
      resolveBinary(linter);
      return { available: true };
    } catch {
      return { available: false, reason: `${linter} is not on PATH.` };
    }
  },

  async run(ctx: RunContext): Promise<GateResult> {
    const start = Date.now();
    const linter = pickLinter(ctx);
    if (!linter) {
      return {
        gate: 'lint',
        status: 'skipped',
        blocking: false,
        duration_ms: Date.now() - start,
        findings: [],
        tool: { name: 'lint', version: null },
        skipped_reason: 'No supported linter detected.',
      };
    }

    const files = ctx.scope === 'full' ? [] : ctx.files.map((f) => resolve(ctx.cwd, f));
    let args: string[];
    let normalise: (raw: unknown) => Finding[];

    switch (linter) {
      case 'eslint':
        args = ['-f', 'json', ...(files.length > 0 ? files : ['.'])];
        normalise = normaliseEslintOutput;
        break;
      case 'ruff':
        args = ['check', '--output-format', 'json', ...(files.length > 0 ? files : ['.'])];
        normalise = normaliseRuffOutput;
        break;
      case 'golangci-lint':
        args = ['run', '--out-format', 'json'];
        normalise = normaliseGolangciOutput;
        break;
    }

    const result = await run(linter, args, { cwd: ctx.cwd, timeoutMs: 60_000 });

    let findings: Finding[] = [];
    try {
      findings = normalise(JSON.parse(result.stdout));
    } catch {
      // Linters print nothing on 0 findings or garbage on crash — treat as pass unless stderr says otherwise.
    }

    if (result.exitCode !== 0 && findings.length === 0 && result.stderr.length > 0) {
      return {
        gate: 'lint',
        status: 'error',
        blocking: false,
        duration_ms: Date.now() - start,
        findings: [],
        tool: { name: linter, version: null },
        error_message: `${linter} failed (exit ${result.exitCode}). stderr: ${result.stderr.slice(0, 400)}`,
      };
    }

    return {
      gate: 'lint',
      status: findings.length > 0 ? 'fail' : 'pass',
      blocking: true,
      duration_ms: Date.now() - start,
      findings,
      tool: { name: linter, version: null },
    };
  },
};
