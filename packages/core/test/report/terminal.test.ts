import { describe, expect, it } from 'vitest';
import { renderJsonReport } from '../../src/report/json.js';
import { renderTerminalReport, summarise } from '../../src/report/terminal.js';
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
        fix_hint: 'Move it to an environment variable and rotate the key.',
        auto_fixable: false,
        rule_ref: null,
        spec_ref: null,
      },
    ],
    tool: { name: 'gitleaks', version: '8.x' },
  },
  {
    gate: 'lint',
    status: 'pass',
    blocking: true,
    duration_ms: 0,
    findings: [],
    tool: { name: 'eslint', version: null },
  },
  {
    gate: 'tests',
    status: 'skipped',
    blocking: false,
    duration_ms: 0,
    findings: [],
    tool: { name: 'tests', version: null },
    skipped_reason: 'No test runner detected.',
  },
];

describe('renderJsonReport', () => {
  it('produces deterministic sorted-key JSON', () => {
    const a = renderJsonReport(RESULTS);
    const b = renderJsonReport([...RESULTS].reverse().reverse()); // same results
    expect(a).toBe(b);
  });

  it('matches the committed snapshot', () => {
    expect(renderJsonReport(RESULTS)).toMatchSnapshot();
  });
});

describe('renderTerminalReport', () => {
  it('contains Problem + Fix lines for every finding (run.md §15 principle 4)', () => {
    const out = renderTerminalReport(RESULTS, { color: false });
    expect(out).toContain('Problem:');
    expect(out).toContain('Fix:');
    expect(out).toContain('Possible API key committed');
  });

  it('shows SKIP + reason for skipped gates (never silently hides)', () => {
    const out = renderTerminalReport(RESULTS, { color: false });
    expect(out).toContain('SKIP');
    expect(out).toContain('No test runner detected.');
  });

  it('shows a summary line with counts per status', () => {
    const out = renderTerminalReport(RESULTS, { color: false });
    expect(out).toContain('1 pass');
    expect(out).toContain('1 fail');
    expect(out).toContain('1 skipped');
  });

  it('matches the committed snapshot (color off)', () => {
    expect(renderTerminalReport(RESULTS, { color: false })).toMatchSnapshot();
  });
});

describe('summarise', () => {
  it('counts blocking failures separately', () => {
    const s = summarise(RESULTS);
    expect(s.fail).toBe(1);
    expect(s.pass).toBe(1);
    expect(s.skipped).toBe(1);
    expect(s.blockingFailures).toBe(1);
  });
});
