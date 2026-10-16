import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normaliseEslintOutput,
  normaliseGolangciOutput,
  normaliseRuffOutput,
  pickLinter,
} from '../../src/gates/lint.js';
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

function ctxWith(profilePatch: Record<string, { values: string[]; confidence: number }>) {
  const stack = emptyStackProfile('/repo', '2026-10-16T00:00:00.000Z');
  return {
    cwd: '/repo',
    stack: {
      ...stack,
      ...profilePatch,
      languages: profilePatch.languages ?? stack.languages,
      linters: profilePatch.linters ?? stack.linters,
    },
    config: CFG,
  };
}

describe('pickLinter', () => {
  it('prefers an explicitly detected linter', () => {
    const ctx = ctxWith({ linters: { values: ['eslint'], confidence: 1 } });
    expect(pickLinter(ctx)).toBe('eslint');
  });

  it('falls back to language if no linter is detected', () => {
    const ctx = ctxWith({ languages: { values: ['python'], confidence: 1 } });
    expect(pickLinter(ctx)).toBe('ruff');
  });

  it('returns null when neither linters nor languages are known', () => {
    const ctx = ctxWith({});
    expect(pickLinter(ctx)).toBeNull();
  });
});

describe('normaliseEslintOutput (recorded-output)', () => {
  it('maps planted violations', () => {
    const findings = normaliseEslintOutput(FX('eslint-sample.json'));
    expect(findings).toHaveLength(3);
    const consoleFinding = findings.find((f) => f.id === 'eslint.no-console');
    expect(consoleFinding?.severity).toBe('error');
    expect(consoleFinding?.file).toBe('/repo/src/server.ts');
    expect(consoleFinding?.line).toBe(20);
  });

  it('is deterministic across runs', () => {
    const a = normaliseEslintOutput(FX('eslint-sample.json'));
    const b = normaliseEslintOutput(FX('eslint-sample.json'));
    expect(a).toEqual(b);
  });
});

describe('normaliseRuffOutput (recorded-output)', () => {
  it('maps ruff JSON including auto_fixable flag', () => {
    const findings = normaliseRuffOutput(FX('ruff-sample.json'));
    expect(findings).toHaveLength(2);
    expect(findings.find((f) => f.id === 'ruff.F401')?.auto_fixable).toBe(true);
    expect(findings.find((f) => f.id === 'ruff.E501')?.auto_fixable).toBe(false);
  });
});

describe('normaliseGolangciOutput (recorded-output)', () => {
  it('maps the `Issues` array to findings', () => {
    const findings = normaliseGolangciOutput(FX('golangci-sample.json'));
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.id)).toEqual(
      expect.arrayContaining(['golangci.govet', 'golangci.ineffassign']),
    );
  });

  it('tolerates missing Issues array', () => {
    expect(normaliseGolangciOutput({})).toEqual([]);
    expect(normaliseGolangciOutput(null)).toEqual([]);
  });
});
