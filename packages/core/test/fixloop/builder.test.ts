import { describe, expect, it } from 'vitest';
import {
  buildCorrectionPrompt,
  CorrectionPayload,
  FORBID_LIST_TEXT,
} from '../../src/fixloop/builder.js';
import type { GateResult } from '../../src/schemas/gate-result.js';

const RESULTS: GateResult[] = [
  {
    gate: 'secrets',
    status: 'fail',
    blocking: true,
    duration_ms: 0,
    findings: [
      {
        id: 'gitleaks.generic-api-key',
        severity: 'error',
        file: 'src/config.js',
        line: 12,
        message: 'Possible API key committed.',
        fix_hint:
          'Move the value to an environment variable; reference process.env.X; add to .env.example.',
        auto_fixable: false,
        rule_ref: null,
        spec_ref: null,
      },
    ],
    tool: { name: 'gitleaks', version: '8.x' },
  },
  {
    gate: 'architecture',
    status: 'fail',
    blocking: true,
    duration_ms: 0,
    findings: [
      {
        id: 'architecture.LAYER-01',
        severity: 'error',
        file: 'src/controllers/user.ts',
        line: 34,
        message: 'Controller imports a repository/DB module directly.',
        fix_hint: 'Call UserService instead; move the query logic into the service.',
        auto_fixable: false,
        rule_ref: 'LAYER-01',
        spec_ref: 'REQ-004',
      },
    ],
    tool: { name: 'dependency-cruiser', version: null },
  },
  {
    gate: 'lint',
    status: 'pass',
    blocking: true,
    duration_ms: 0,
    findings: [],
    tool: { name: 'eslint', version: null },
  },
];

describe('buildCorrectionPrompt', () => {
  it('header shows the attempt + max; no leaked secret', () => {
    const { text } = buildCorrectionPrompt(RESULTS, { attempt: 1, maxAttempts: 3 });
    expect(text).toContain('SpecGate check failed (attempt 1/3)');
    expect(text).not.toContain('sk-'); // in case our fixture ever contains a real-looking key
  });

  it('includes the §13.3 forbid-list text verbatim (regression guard)', () => {
    const { text, payload } = buildCorrectionPrompt(RESULTS, { attempt: 1, maxAttempts: 3 });
    expect(text).toContain(FORBID_LIST_TEXT);
    expect(payload.forbid).toBe(FORBID_LIST_TEXT);
  });

  it('one item per blocking finding, with Problem / Do / Rule-Spec lines', () => {
    const { text, payload } = buildCorrectionPrompt(RESULTS, { attempt: 1, maxAttempts: 3 });
    expect(payload.items).toHaveLength(2);
    expect(text).toContain('[1] secrets');
    expect(text).toContain('[2] architecture');
    expect(text).toContain('Problem:');
    expect(text).toContain('Do:');
    expect(text).toContain('Rule/Spec:');
    expect(text).toContain('LAYER-01, REQ-004');
  });

  it('skips non-blocking + passing + skipped results', () => {
    const { payload } = buildCorrectionPrompt(
      [
        ...RESULTS,
        {
          gate: 'tests',
          status: 'skipped',
          blocking: false,
          duration_ms: 0,
          findings: [],
          tool: { name: 'vitest', version: null },
          skipped_reason: 'runner missing',
        },
      ],
      { attempt: 1, maxAttempts: 3 },
    );
    expect(payload.items.every((i) => i.gate !== 'tests')).toBe(true);
  });

  it('truncates when exceeding the token budget and reports omitted_count', () => {
    const big: GateResult = {
      gate: 'lint',
      status: 'fail',
      blocking: true,
      duration_ms: 0,
      findings: Array.from({ length: 50 }, (_, i) => ({
        id: `lint.rule-${i}`,
        severity: 'error' as const,
        file: `src/${i}.ts`,
        line: i + 1,
        message: `Problem ${i} '.repeat(80)' and then some more text to blow the budget`,
        fix_hint: 'Fix it (details omitted for budget).',
        auto_fixable: false,
        rule_ref: null,
        spec_ref: null,
      })),
      tool: { name: 'eslint', version: null },
    };
    const { payload } = buildCorrectionPrompt([big], {
      attempt: 1,
      maxAttempts: 3,
      tokenBudget: 300,
    });
    expect(payload.items.length).toBeLessThan(50);
    expect(payload.omitted_count).toBeGreaterThan(0);
  });

  it('output text ends with the "After fixing, run: specgate check" instruction', () => {
    const { text } = buildCorrectionPrompt(RESULTS, { attempt: 1, maxAttempts: 3 });
    expect(text).toContain('After fixing, run: specgate check');
  });

  it('CorrectionPayload shape matches the committed snapshot (golden)', () => {
    const { payload } = buildCorrectionPrompt(RESULTS, { attempt: 1, maxAttempts: 3 });
    expect(() => CorrectionPayload.parse(payload)).not.toThrow();
    expect(payload).toMatchSnapshot();
  });

  it('text output matches the committed snapshot (golden §13.2 template)', () => {
    const { text } = buildCorrectionPrompt(RESULTS, { attempt: 1, maxAttempts: 3 });
    expect(text).toMatchSnapshot();
  });
});
