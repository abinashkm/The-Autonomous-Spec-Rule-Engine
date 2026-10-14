import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../../src/schemas/config.js';

/**
 * Verbatim example from run.md §7.2 (translated from YAML to JS).
 */
const RUN_MD_EXAMPLE = {
  version: 1,
  strictness: 'standard',
  stack: { override: {} },
  packs: [
    { name: 'clean-code-core', version: '1.2.0' },
    { name: 'ts-node-layered', version: '0.3.1' },
  ],
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
} as const;

describe('ConfigSchema', () => {
  it('parses the run.md §7.2 example verbatim', () => {
    const parsed = ConfigSchema.parse(RUN_MD_EXAMPLE);
    expect(parsed.strictness).toBe('standard');
    expect(parsed.gates.secrets.tool).toBe('gitleaks');
    expect(parsed.packs).toHaveLength(2);
  });

  it('rejects unknown gates (strict mode)', () => {
    const bad = {
      ...RUN_MD_EXAMPLE,
      gates: { ...RUN_MD_EXAMPLE.gates, mystery: { enabled: true } },
    };
    expect(() => ConfigSchema.parse(bad)).toThrow(/Unknown gate|Unrecognized/);
  });

  it('rejects an invalid strictness value', () => {
    const bad = { ...RUN_MD_EXAMPLE, strictness: 'yolo' } as unknown;
    const result = ConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['strictness']);
    }
  });

  it('rejects a disabled gate missing a reason (run.md §13.3)', () => {
    const bad = {
      ...RUN_MD_EXAMPLE,
      gates: {
        ...RUN_MD_EXAMPLE.gates,
        tests: { enabled: false, command: 'auto', blocking_at: 'standard' },
      },
    };
    const result = ConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.').includes('tests.reason'))).toBe(true);
    }
  });

  it('accepts a disabled gate with a reason', () => {
    const ok = {
      ...RUN_MD_EXAMPLE,
      gates: {
        ...RUN_MD_EXAMPLE.gates,
        tests: {
          enabled: false,
          command: 'auto',
          blocking_at: 'standard',
          reason: 'runtime unavailable in this environment',
        },
      },
    };
    expect(() => ConfigSchema.parse(ok)).not.toThrow();
  });
});
