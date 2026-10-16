import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalisePytestOutput, normaliseVitestOutput, pickRunner } from '../../src/gates/tests.js';
import { emptyStackProfile } from '../../src/schemas/stack-profile.js';
import { ConfigSchema } from '../../src/schemas/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FX = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(__dirname, '..', 'fixtures', name), 'utf8'));

const CFG = ConfigSchema.parse({
  version: 1,
  strictness: 'standard',
  stack: { override: {} },
  packs: [],
  gates: {
    secrets: { enabled: true, tool: 'gitleaks', blocking_at: 'standard' },
    lint: { enabled: true, command: 'auto', blocking_at: 'standard' },
    tests: { enabled: true, command: 'auto', blocking_at: 'standard' },
    coverage: { enabled: true, changed_files_min: 70, blocking_at: 'strict' },
    architecture: { enabled: true, blocking_at: 'strict' },
    dependencies: { enabled: true, tool: 'osv-scanner', blocking_at: 'strict' },
    spec: { enabled: true, require_spec_for_changes: true, blocking_at: 'strict' },
  },
  fix_loop: { max_attempts: 3 },
  context: { max_rule_tokens: 4000 },
  telemetry: 'off',
});

function ctxWith(testRunners: string[], languages: string[] = []) {
  const stack = emptyStackProfile('/repo', '2026-10-16T00:00:00.000Z');
  return {
    cwd: '/repo',
    stack: {
      ...stack,
      testRunners: { values: testRunners, confidence: testRunners.length ? 1 : 0 },
      languages: { values: languages, confidence: languages.length ? 1 : 0 },
    },
    config: CFG,
  };
}

describe('pickRunner', () => {
  it('prefers vitest when present', () => {
    expect(pickRunner(ctxWith(['vitest']))).toBe('vitest');
  });

  it('falls back to go when only Go is detected', () => {
    expect(pickRunner(ctxWith([], ['go']))).toBe('go');
  });

  it('returns null when nothing is detected', () => {
    expect(pickRunner(ctxWith([]))).toBeNull();
  });
});

describe('normaliseVitestOutput (recorded-output)', () => {
  it('reports only failing tests', () => {
    const findings = normaliseVitestOutput(FX('vitest-sample.json'));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.id).toContain('handles_zero_rows');
    expect(findings[0]!.file).toBe('/repo/test/csv.test.ts');
    expect(findings[0]!.line).toBe(22);
    expect(findings[0]!.severity).toBe('error');
  });

  it('handles empty / garbage input', () => {
    expect(normaliseVitestOutput(null)).toEqual([]);
    expect(normaliseVitestOutput({})).toEqual([]);
    expect(normaliseVitestOutput({ testResults: [] })).toEqual([]);
  });
});

describe('normalisePytestOutput (recorded-output)', () => {
  it('reports only failed/error tests', () => {
    const findings = normalisePytestOutput(FX('pytest-sample.json'));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.file).toBe('tests/test_smoke.py');
    expect(findings[0]!.line).toBe(25);
    expect(findings[0]!.message).toContain('expected 200');
  });
});
