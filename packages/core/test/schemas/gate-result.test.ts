import { describe, expect, it } from 'vitest';
import { GateResult } from '../../src/schemas/gate-result.js';

/** run.md §7.4 verbatim example. */
const RUN_MD_7_4_EXAMPLE = {
  gate: 'secrets',
  status: 'fail' as const,
  blocking: true,
  duration_ms: 412,
  findings: [
    {
      id: 'gitleaks.generic-api-key',
      severity: 'error' as const,
      file: 'src/config.js',
      line: 12,
      message: 'Possible API key committed.',
      fix_hint: 'Move it to an environment variable (.env, gitignored) and rotate the key.',
      auto_fixable: false,
      rule_ref: null,
      spec_ref: null,
    },
  ],
  tool: { name: 'gitleaks', version: '8.x' },
};

describe('GateResult', () => {
  it('parses the run.md §7.4 example', () => {
    const parsed = GateResult.parse(RUN_MD_7_4_EXAMPLE);
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.status).toBe('fail');
  });

  it('rejects an unknown status', () => {
    const bad = { ...RUN_MD_7_4_EXAMPLE, status: 'ok' } as unknown;
    const r = GateResult.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it("requires 'skipped' to carry a reason", () => {
    const bad = {
      gate: 'tests',
      status: 'skipped' as const,
      blocking: false,
      duration_ms: 0,
      findings: [],
      tool: { name: 'vitest', version: null },
    };
    const r = GateResult.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]!.path).toEqual(['skipped_reason']);
    }
  });

  it("accepts 'skipped' with a reason", () => {
    const ok = {
      gate: 'tests',
      status: 'skipped' as const,
      blocking: false,
      duration_ms: 0,
      findings: [],
      tool: { name: 'vitest', version: null },
      skipped_reason: 'test runner not available',
    };
    expect(() => GateResult.parse(ok)).not.toThrow();
  });

  it("requires 'error' to carry an error message", () => {
    const bad = {
      gate: 'secrets',
      status: 'error' as const,
      blocking: true,
      duration_ms: 50,
      findings: [],
      tool: { name: 'gitleaks', version: '8.x' },
    };
    const r = GateResult.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it("rejects 'pass' with findings", () => {
    const bad = { ...RUN_MD_7_4_EXAMPLE, status: 'pass' as const };
    const r = GateResult.safeParse(bad);
    expect(r.success).toBe(false);
  });
});
