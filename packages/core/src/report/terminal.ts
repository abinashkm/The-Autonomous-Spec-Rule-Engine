import pc from 'picocolors';
import type { Finding, GateResult } from '../schemas/gate-result.js';

/**
 * Pretty terminal report.
 * Source of truth: run.md §5.8, §15 principle 4 (plain-English failures with
 * a suggested fix).
 *
 * Format per finding: one block of 3-4 lines.
 *   [severity] gate — file:line  (rule_ref, spec_ref)
 *     Problem: <message>
 *     Fix:     <fix_hint>
 */

export interface TerminalOptions {
  readonly color?: boolean;
}

function col(enabled: boolean) {
  if (!enabled) {
    return {
      red: (s: string) => s,
      yellow: (s: string) => s,
      green: (s: string) => s,
      gray: (s: string) => s,
      bold: (s: string) => s,
      dim: (s: string) => s,
      cyan: (s: string) => s,
    };
  }
  return pc;
}

function tag(status: GateResult['status'], c: ReturnType<typeof col>): string {
  switch (status) {
    case 'pass':
      return c.green('PASS   ');
    case 'fail':
      return c.red('FAIL   ');
    case 'warn':
      return c.yellow('WARN   ');
    case 'skipped':
      return c.gray('SKIP   ');
    case 'error':
      return c.red('ERROR  ');
  }
}

function renderFinding(f: Finding, c: ReturnType<typeof col>): string {
  const sev =
    f.severity === 'error'
      ? c.red('[error]')
      : f.severity === 'warning'
        ? c.yellow('[warn] ')
        : c.cyan('[info] ');
  const where = f.line != null ? `${f.file}:${f.line}` : f.file;
  const refs: string[] = [];
  if (f.rule_ref) refs.push(c.dim(`rule:${f.rule_ref}`));
  if (f.spec_ref) refs.push(c.dim(`spec:${f.spec_ref}`));
  const header = `  ${sev} ${c.bold(where)}${refs.length ? '  ' + refs.join(' ') : ''}`;
  return [header, `      Problem: ${f.message}`, `      Fix:     ${f.fix_hint}`, ''].join('\n');
}

export function renderTerminalReport(
  results: readonly GateResult[],
  options: TerminalOptions = {},
): string {
  const c = col(options.color ?? true);
  const parts: string[] = [];
  parts.push(c.bold('SpecGate check') + '\n');
  for (const r of results) {
    const header =
      `${tag(r.status, c)} ${c.bold(r.gate)}` +
      (r.tool.name && r.tool.name !== r.gate ? c.dim(` (${r.tool.name})`) : '') +
      (r.blocking ? '' : c.dim(' [non-blocking]'));
    parts.push(header);
    if (r.status === 'skipped' && r.skipped_reason) {
      parts.push(c.dim(`  reason: ${r.skipped_reason}`));
    }
    if (r.status === 'error' && r.error_message) {
      parts.push(c.red(`  ${r.error_message}`));
    }
    if (r.findings.length > 0) {
      parts.push('');
      for (const f of r.findings) parts.push(renderFinding(f, c));
    }
    parts.push('');
  }

  const totals = summarise(results);
  parts.push(
    c.bold('Summary:') +
      `  ${c.green(totals.pass + ' pass')}` +
      `  ${c.red(totals.fail + ' fail')}` +
      `  ${c.yellow(totals.warn + ' warn')}` +
      `  ${c.gray(totals.skipped + ' skipped')}` +
      `  ${c.red(totals.error + ' error')}`,
  );
  return parts.join('\n') + '\n';
}

export function summarise(results: readonly GateResult[]): {
  pass: number;
  fail: number;
  warn: number;
  skipped: number;
  error: number;
  blockingFailures: number;
} {
  const t = { pass: 0, fail: 0, warn: 0, skipped: 0, error: 0, blockingFailures: 0 };
  for (const r of results) {
    t[r.status] += 1;
    if (r.blocking && (r.status === 'fail' || r.status === 'error')) t.blockingFailures += 1;
  }
  return t;
}
