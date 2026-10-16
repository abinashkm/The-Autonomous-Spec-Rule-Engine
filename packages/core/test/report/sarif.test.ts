import { describe, expect, it } from 'vitest';
import { renderSarifReport } from '../../src/report/sarif.js';
import { renderMarkdownReport, PR_COMMENT_MARKER } from '../../src/report/markdown.js';
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
        fix_hint: 'Move it to an env var and rotate.',
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
];

describe('renderSarifReport', () => {
  it('emits SARIF 2.1.0 with the required top-level shape', () => {
    const doc = JSON.parse(renderSarifReport(RESULTS, { toolVersion: '0.0.0' })) as {
      $schema: string;
      version: string;
      runs: Array<{ tool: { driver: { name: string; rules: unknown[] } }; results: unknown[] }>;
    };
    expect(doc.version).toBe('2.1.0');
    expect(doc.$schema).toContain('sarif-schema-2.1.0.json');
    expect(doc.runs).toHaveLength(1);
    expect(doc.runs[0]!.tool.driver.name).toBe('SpecGate');
    expect(doc.runs[0]!.results).toHaveLength(1);
  });

  it('each finding gets a `ruleId` + `ruleIndex` into the driver rules array', () => {
    const doc = JSON.parse(renderSarifReport(RESULTS)) as {
      runs: Array<{
        tool: { driver: { rules: Array<{ id: string }> } };
        results: Array<{ ruleId: string; ruleIndex: number }>;
      }>;
    };
    const rules = doc.runs[0]!.tool.driver.rules;
    const result = doc.runs[0]!.results[0]!;
    expect(result.ruleId).toBe('gitleaks.generic-api-key');
    expect(rules[result.ruleIndex]?.id).toBe('gitleaks.generic-api-key');
  });

  it('converts an absolute file path to a repo-relative URI when repoRoot is given', () => {
    const results: GateResult[] = [
      {
        ...RESULTS[0]!,
        findings: [{ ...RESULTS[0]!.findings[0]!, file: 'C:/repo/src/config.js' }],
      },
    ];
    const doc = JSON.parse(renderSarifReport(results, { repoRoot: 'C:/repo' })) as {
      runs: Array<{
        results: Array<{
          locations: Array<{
            physicalLocation: { artifactLocation: { uri: string } };
          }>;
        }>;
      }>;
    };
    expect(doc.runs[0]!.results[0]!.locations[0]!.physicalLocation.artifactLocation.uri).toBe(
      'src/config.js',
    );
  });

  it('includes a partialFingerprints block so GitHub de-dupes between runs', () => {
    const doc = JSON.parse(renderSarifReport(RESULTS)) as {
      runs: Array<{ results: Array<{ partialFingerprints?: Record<string, string> }> }>;
    };
    const fp = doc.runs[0]!.results[0]!.partialFingerprints;
    expect(fp).toBeDefined();
    expect(Object.keys(fp!)).toContain('specgate.finding.id');
  });

  it('matches the committed snapshot', () => {
    expect(renderSarifReport(RESULTS, { toolVersion: '0.0.0' })).toMatchSnapshot();
  });
});

describe('renderMarkdownReport', () => {
  it('contains a Summary line and a table row per gate', () => {
    const md = renderMarkdownReport(RESULTS);
    expect(md).toContain('# SpecGate');
    expect(md).toContain('Summary:');
    expect(md).toContain('| `secrets` |');
    expect(md).toContain('| `lint` |');
  });

  it('includes Problem + Fix lines per finding', () => {
    const md = renderMarkdownReport(RESULTS);
    expect(md).toContain('**Problem:**');
    expect(md).toContain('**Fix:**');
    expect(md).toContain('src/config.js:12');
  });

  it('matches the committed snapshot', () => {
    expect(renderMarkdownReport(RESULTS)).toMatchSnapshot();
  });
});

describe('PR comment marker', () => {
  it('is a stable HTML-comment token the Action can grep for', () => {
    expect(PR_COMMENT_MARKER).toBe('<!-- specgate-pr-comment -->');
  });
});
