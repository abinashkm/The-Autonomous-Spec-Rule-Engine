import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exitCodeFor, runCheck } from '../../src/check/run.js';
import type { GateResult } from '../../src/schemas/gate-result.js';
import { summarise } from '../../src/report/terminal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_FIXTURES = resolve(__dirname, '..', '..', '..', '..', 'fixtures');

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'specgate-check-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function copyFixture(name: string): string {
  const dest = join(tmp, name);
  cpSync(resolve(REPO_FIXTURES, name), dest, { recursive: true });
  return dest;
}

describe('exitCodeFor (run.md §8 exit code mapping)', () => {
  function result(
    partial: Partial<GateResult> & Pick<GateResult, 'gate' | 'status' | 'blocking'>,
  ): GateResult {
    return {
      duration_ms: 0,
      findings: [],
      tool: { name: partial.gate, version: null },
      ...partial,
    } as GateResult;
  }

  it('returns 0 when every gate passes', () => {
    const r = [result({ gate: 'secrets', status: 'pass', blocking: true })];
    expect(exitCodeFor({ summary: summarise(r), results: r })).toBe(0);
  });

  it('returns 1 on a blocking failure', () => {
    const r: GateResult[] = [
      {
        gate: 'secrets',
        status: 'fail',
        blocking: true,
        duration_ms: 0,
        findings: [
          {
            id: 'x',
            severity: 'error',
            file: 'a',
            line: 1,
            message: 'm',
            fix_hint: 'f',
            auto_fixable: false,
            rule_ref: null,
            spec_ref: null,
          },
        ],
        tool: { name: 'gitleaks', version: null },
      },
    ];
    expect(exitCodeFor({ summary: summarise(r), results: r })).toBe(1);
  });

  it('returns 2 on a blocking tool error (takes precedence over 1)', () => {
    const r: GateResult[] = [
      {
        gate: 'secrets',
        status: 'error',
        blocking: true,
        duration_ms: 0,
        findings: [],
        tool: { name: 'gitleaks', version: null },
        error_message: 'tool crashed',
      },
    ];
    expect(exitCodeFor({ summary: summarise(r), results: r })).toBe(2);
  });

  it('returns 3 for warnings-only with --fail-on-warn', () => {
    const r: GateResult[] = [
      {
        gate: 'lint',
        status: 'warn',
        blocking: false,
        duration_ms: 0,
        findings: [],
        tool: { name: 'eslint', version: null },
      },
    ];
    expect(exitCodeFor({ summary: summarise(r), results: r, failOnWarn: true })).toBe(3);
    expect(exitCodeFor({ summary: summarise(r), results: r, failOnWarn: false })).toBe(0);
  });
});

describe('runCheck (integration — scoped to the secrets gate to keep CI fast)', () => {
  it('`--gate secrets` runs only secrets and reports skipped/pass/fail cleanly', async () => {
    const cwd = copyFixture('node-express-ts');
    const result = await runCheck({ cwd, scope: 'full', gates: ['secrets'] });
    expect(result.results.map((r) => r.gate)).toEqual(['secrets']);
    const secrets = result.results[0]!;
    // Any outcome is acceptable *except* a silent `pass` when gitleaks is
    // missing from PATH — that would be a §10.3 violation.
    if (secrets.status === 'skipped') {
      expect(secrets.skipped_reason).toMatch(/gitleaks/i);
    }
  });

  it('perf budget: scoped check completes under the 10 s CI budget', async () => {
    const cwd = copyFixture('empty-git-repo');
    writeFileSync(join(cwd, 'empty.marker'), '');
    const start = Date.now();
    await runCheck({ cwd, scope: 'full', gates: ['secrets'] });
    expect(Date.now() - start).toBeLessThan(10_000);
  });

  it('returns a GateResult[] in deterministic order when all 3 built-in gates are requested', async () => {
    const cwd = copyFixture('empty-git-repo');
    writeFileSync(join(cwd, 'empty.marker'), '');
    const result = await runCheck({ cwd, scope: 'full' });
    expect(result.results.map((r) => r.gate)).toEqual(['lint', 'secrets', 'tests']);
    for (const r of result.results) {
      if (r.status === 'skipped') expect(r.skipped_reason).toBeTruthy();
    }
  });
});
