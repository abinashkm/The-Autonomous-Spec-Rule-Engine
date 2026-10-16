import type { Gate, GateAvailability, RepoContext, RunContext } from './types.js';
import type { Finding, GateResult } from '../schemas/gate-result.js';
import { resolveBinary, run } from '../subprocess/run.js';

/**
 * Tests gate.
 * Source of truth: run.md §10.2.
 *
 * Auto-detect order:
 *   1. vitest (TS/JS)
 *   2. jest  (TS/JS)
 *   3. pytest (Python)
 *   4. go test (Go)
 *
 * Normalisers are pure and exported — recorded-output tests exercise them
 * without the runner installed on CI.
 */

type Runner = 'vitest' | 'jest' | 'pytest' | 'go';

export function pickRunner(ctx: RepoContext): Runner | null {
  const trs = new Set(ctx.stack.testRunners.values);
  if (trs.has('vitest')) return 'vitest';
  if (trs.has('jest')) return 'jest';
  if (trs.has('pytest')) return 'pytest';
  const langs = new Set(ctx.stack.languages.values);
  if (langs.has('go')) return 'go';
  return null;
}

/* -------------------------- vitest normaliser ------------------------- */

interface VitestAssertion {
  readonly ancestorTitles?: readonly string[];
  readonly fullName?: string;
  readonly title?: string;
  readonly status: 'passed' | 'failed' | 'pending' | 'skipped' | 'todo';
  readonly failureMessages?: readonly string[];
  readonly location?: { readonly line?: number; readonly column?: number };
}
interface VitestFile {
  readonly name?: string;
  readonly testResults?: readonly VitestAssertion[];
}
interface VitestReport {
  readonly testResults?: readonly VitestFile[];
  readonly numFailedTests?: number;
}

export function normaliseVitestOutput(json: unknown): Finding[] {
  if (!json || typeof json !== 'object') return [];
  const report = json as VitestReport;
  const files = report.testResults ?? [];
  const out: Finding[] = [];
  for (const file of files) {
    for (const t of file.testResults ?? []) {
      if (t.status !== 'failed') continue;
      const title = t.fullName ?? [...(t.ancestorTitles ?? []), t.title ?? ''].join(' > ');
      const msg = (t.failureMessages ?? []).join('\n').trim() || 'Test failed.';
      out.push({
        id: `tests.vitest.${title.replace(/\s+/g, '_').slice(0, 80) || 'anonymous'}`,
        severity: 'error',
        file: file.name ?? '',
        line: t.location?.line ?? null,
        message: `${title}: ${msg.slice(0, 500)}`,
        fix_hint: 'Make the failing assertion true.',
        auto_fixable: false,
        rule_ref: null,
        spec_ref: null,
      });
    }
  }
  return sortFindings(out);
}

/* --------------------------- pytest normaliser ------------------------ */

interface PytestNode {
  readonly nodeid: string;
  readonly outcome: 'passed' | 'failed' | 'skipped' | 'error';
  readonly longrepr?: string | null;
  readonly location?: readonly [string, number, string];
}
interface PytestReport {
  readonly tests?: readonly PytestNode[];
}

export function normalisePytestOutput(json: unknown): Finding[] {
  if (!json || typeof json !== 'object') return [];
  const report = json as PytestReport;
  const out: Finding[] = [];
  for (const t of report.tests ?? []) {
    if (t.outcome !== 'failed' && t.outcome !== 'error') continue;
    const [file, line] = t.location ?? ['', 0, ''];
    const msg = (t.longrepr ?? '').trim().slice(0, 500) || 'Test failed.';
    out.push({
      id: `tests.pytest.${t.nodeid.replace(/\s+/g, '_').slice(0, 80)}`,
      severity: 'error',
      file: file ?? '',
      line: Number.isFinite(line) ? Number(line) : null,
      message: `${t.nodeid}: ${msg}`,
      fix_hint: 'Make the failing assertion true.',
      auto_fixable: false,
      rule_ref: null,
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

/* ------------------------------ gate impl ----------------------------- */

export const TestsGate: Gate = {
  id: 'tests',
  scopes: ['changed', 'full'],
  defaultBlockingAt: 'standard',

  async detect(ctx: RepoContext): Promise<GateAvailability> {
    const runner = pickRunner(ctx);
    if (!runner)
      return { available: false, reason: 'No supported test runner detected for this stack.' };
    // vitest/jest/pytest ship via project deps; `go` ships standalone.
    const binary =
      runner === 'vitest' || runner === 'jest' ? 'npx' : runner === 'pytest' ? 'pytest' : 'go';
    try {
      resolveBinary(binary);
      return { available: true };
    } catch {
      return { available: false, reason: `${binary} is not on PATH.` };
    }
  },

  async run(ctx: RunContext): Promise<GateResult> {
    const start = Date.now();
    const runner = pickRunner(ctx);
    if (!runner) {
      return {
        gate: 'tests',
        status: 'skipped',
        blocking: false,
        duration_ms: Date.now() - start,
        findings: [],
        tool: { name: 'tests', version: null },
        skipped_reason: 'No supported test runner detected.',
      };
    }

    let binary: string;
    let args: string[];
    let normalise: (raw: unknown) => Finding[];

    switch (runner) {
      case 'vitest':
        binary = 'npx';
        args = ['vitest', 'run', '--reporter=json'];
        normalise = normaliseVitestOutput;
        break;
      case 'jest':
        binary = 'npx';
        args = ['jest', '--json'];
        normalise = normaliseVitestOutput; // Vitest JSON schema is a superset
        break;
      case 'pytest':
        binary = 'pytest';
        args = ['-q', '--json-report', '--json-report-file=.specgate/pytest-report.json'];
        normalise = normalisePytestOutput;
        break;
      case 'go':
        binary = 'go';
        args = ['test', './...'];
        normalise = () => []; // M3 stub — go test JSON parsing can land with the Go pack
        break;
    }

    const result = await run(binary, args, { cwd: ctx.cwd, timeoutMs: 300_000 });

    let findings: Finding[] = [];
    try {
      // Vitest/jest emit JSON to stdout; pytest writes to the file we passed.
      const raw =
        runner === 'pytest' ? JSON.parse(result.stdout || '{}') : JSON.parse(result.stdout || '{}');
      findings = normalise(raw);
    } catch {
      // Non-JSON output on success is fine for `go test`; otherwise findings stays empty.
    }

    const toolError =
      result.exitCode !== 0 && findings.length === 0 && result.stderr.length > 0 && runner !== 'go';
    if (toolError) {
      return {
        gate: 'tests',
        status: 'error',
        blocking: true,
        duration_ms: Date.now() - start,
        findings: [],
        tool: { name: runner, version: null },
        error_message: `${runner} failed (exit ${result.exitCode}). stderr: ${result.stderr.slice(0, 400)}`,
      };
    }

    const failed = findings.length > 0 || (runner === 'go' && result.exitCode !== 0);
    return {
      gate: 'tests',
      status: failed ? 'fail' : 'pass',
      blocking: true,
      duration_ms: Date.now() - start,
      findings,
      tool: { name: runner, version: null },
    };
  },
};
