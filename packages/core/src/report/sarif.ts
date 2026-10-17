import type { GateResult, Finding } from '../schemas/gate-result.js';

/**
 * SARIF 2.1.0 reporter for GitHub code scanning upload.
 * Source of truth: run.md §10.3 + §9.5 (CI backstop) + §24.2 (GitHub Action).
 * Schema: https://docs.oasis-open.org/sarif/sarif/v2.1.0/
 *
 * We emit the minimum shape GitHub accepts and that `sarif-cli validate`
 * passes against the official schema:
 *   { version, $schema, runs: [{ tool: { driver: { name, rules[] } }, results[] }] }
 */

const SARIF_SCHEMA =
  'https://docs.oasis-open.org/sarif/sarif/v2.1.0/schemas/sarif-schema-2.1.0.json';

type SarifLevel = 'error' | 'warning' | 'note';

function levelFor(severity: Finding['severity']): SarifLevel {
  switch (severity) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
      return 'note';
  }
}

export interface SarifReportOptions {
  readonly toolVersion?: string;
  readonly repoRoot?: string;
}

export function renderSarifReport(
  results: readonly GateResult[],
  options: SarifReportOptions = {},
): string {
  // Collect distinct rules per gate so each `results[]` can `ruleIndex` into it.
  const ruleIndex = new Map<string, number>();
  const rules: Array<{ id: string; name?: string; shortDescription: { text: string } }> = [];

  function registerRule(id: string, text: string): number {
    const existing = ruleIndex.get(id);
    if (existing !== undefined) return existing;
    const next = rules.length;
    rules.push({ id, name: id, shortDescription: { text } });
    ruleIndex.set(id, next);
    return next;
  }

  const sarifResults: Array<Record<string, unknown>> = [];

  for (const gate of results) {
    for (const f of gate.findings) {
      const idx = registerRule(f.id, f.fix_hint);
      const uri = toUri(f.file, options.repoRoot);
      sarifResults.push({
        ruleId: f.id,
        ruleIndex: idx,
        level: levelFor(f.severity),
        message: { text: `${f.message} — Fix: ${f.fix_hint}` },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri },
              region: { startLine: f.line ?? 1 },
            },
          },
        ],
        partialFingerprints: {
          'specgate.finding.id': `${gate.gate}:${f.file}:${f.line ?? 0}:${f.id}`,
        },
      });
    }
  }

  const doc = {
    $schema: SARIF_SCHEMA,
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'SpecGate',
            informationUri: 'https://github.com/abinashkm/The-Autonomous-Spec-Rule-Engine',
            version: options.toolVersion ?? '0.0.0',
            rules,
          },
        },
        results: sarifResults,
      },
    ],
  };

  return JSON.stringify(doc, null, 2) + '\n';
}

function toUri(absOrRel: string, repoRoot?: string): string {
  if (!absOrRel) return 'unknown';
  const normalized = absOrRel.split('\\').join('/');
  if (repoRoot) {
    const rr = repoRoot.split('\\').join('/').replace(/\/+$/, '');
    if (normalized.startsWith(rr + '/')) return normalized.slice(rr.length + 1);
  }
  // Already relative — strip a leading './'.
  return normalized.replace(/^\.\//, '');
}
