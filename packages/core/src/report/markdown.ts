import type { GateResult } from '../schemas/gate-result.js';
import { summarise } from './terminal.js';

/**
 * Markdown report for GitHub PR comments.
 * Source of truth: run.md §9.5 + §24.2.
 *
 * The PR-comment layout:
 *   # SpecGate
 *   | gate | status | findings | notes |
 *   ---
 *   ### gate (fail): ...
 *   - file:line — message. Fix: hint.
 */

export function renderMarkdownReport(results: readonly GateResult[]): string {
  const totals = summarise(results);
  const header = [
    '# SpecGate',
    '',
    `**Summary:** ${totals.pass} pass · ${totals.fail} fail · ${totals.warn} warn · ${totals.skipped} skipped · ${totals.error} error`,
    '',
    '| Gate | Status | Blocking | Findings | Notes |',
    '|---|---|---|---|---|',
  ];
  for (const r of results) {
    const notes =
      r.status === 'skipped' && r.skipped_reason
        ? r.skipped_reason
        : r.status === 'error' && r.error_message
          ? r.error_message
          : '';
    header.push(
      `| \`${r.gate}\` | ${badge(r.status)} | ${r.blocking ? 'yes' : 'no'} | ${r.findings.length} | ${escapeCell(notes)} |`,
    );
  }

  const details: string[] = [];
  for (const r of results) {
    if (r.findings.length === 0) continue;
    details.push('', `### ${r.gate} — ${r.findings.length} finding(s)`, '');
    for (const f of r.findings) {
      const where = f.line != null ? `${f.file}:${f.line}` : f.file;
      details.push(`- **${severityPill(f.severity)}** \`${where}\``);
      details.push(`  - **Problem:** ${escapeInline(f.message)}`);
      details.push(`  - **Fix:** ${escapeInline(f.fix_hint)}`);
    }
  }
  return [...header, ...details, ''].join('\n');
}

function badge(status: GateResult['status']): string {
  switch (status) {
    case 'pass':
      return '✅ pass';
    case 'fail':
      return '❌ fail';
    case 'warn':
      return '⚠️ warn';
    case 'skipped':
      return '➖ skipped';
    case 'error':
      return '🛑 error';
  }
}

function severityPill(sev: 'error' | 'warning' | 'info'): string {
  if (sev === 'error') return 'error';
  if (sev === 'warning') return 'warn';
  return 'info';
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 160);
}

function escapeInline(s: string): string {
  return s.replace(/\r?\n/g, ' ');
}

/** A stable marker string the PR-comment updater uses to find and update the
 *  existing comment instead of posting duplicates (M4.C.2). */
export const PR_COMMENT_MARKER = '<!-- specgate-pr-comment -->';
