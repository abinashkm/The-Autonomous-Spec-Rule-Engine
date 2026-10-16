import { z } from 'zod';
import type { Finding, GateResult } from '../schemas/gate-result.js';

/**
 * Correction-prompt builder.
 * Source of truth: run.md §13.2 (text template) + §13.3 (forbid-list) + §22.
 *
 * Produces two artifacts from a failed check:
 *   1. a plain-text prompt (consumed by agents reading stdout / Claude Code's
 *      Stop hook feedback field)
 *   2. a structured JSON payload (consumed by the MCP `check` tool in M6)
 */

/* ------------------------------ constants ----------------------------- */

/** Verbatim §13.3 safeguard text. Every generated prompt MUST include this. */
export const FORBID_LIST_TEXT =
  'Do not edit .specgate/config.yaml, baseline, or rule files to make this pass.';

export const CORRECTION_PROMPT_TOKEN_BUDGET = 1500;

/* ------------------------------ schema -------------------------------- */

const CorrectionItem = z.object({
  gate: z.string().min(1),
  rule_id: z.string().min(1),
  severity: z.enum(['error', 'warning', 'info']),
  file: z.string().min(1),
  line: z.number().int().min(1).nullable(),
  problem: z.string().min(1),
  fix: z.string().min(1),
  rule_ref: z.string().nullable(),
  spec_ref: z.string().nullable(),
});

export const CorrectionPayload = z
  .object({
    attempt: z.number().int().min(1),
    max_attempts: z.number().int().min(1),
    forbid: z.string().min(1),
    items: z.array(CorrectionItem),
    omitted_count: z.number().int().min(0).default(0),
  })
  .strict();
export type CorrectionPayload = z.infer<typeof CorrectionPayload>;

/* ------------------------------ builder ------------------------------- */

export interface BuilderOptions {
  readonly attempt: number;
  readonly maxAttempts: number;
  /** Approximate token budget for the text prompt. 4 chars ~= 1 token. */
  readonly tokenBudget?: number;
}

export interface CorrectionPrompt {
  readonly text: string;
  readonly payload: CorrectionPayload;
}

/**
 * Group blocking findings by file, order by severity (error > warning > info)
 * then by line, truncate to the token budget, render the §13.2 template.
 */
export function buildCorrectionPrompt(
  results: readonly GateResult[],
  options: BuilderOptions,
): CorrectionPrompt {
  const budget = options.tokenBudget ?? CORRECTION_PROMPT_TOKEN_BUDGET;

  // Collect blocking findings only.
  const flat: Array<{ gate: string; f: Finding }> = [];
  for (const r of results) {
    if (!r.blocking) continue;
    if (r.status !== 'fail' && r.status !== 'error') continue;
    for (const f of r.findings) flat.push({ gate: r.gate, f });
  }

  // Order: severity (error first), then file, then line, then id.
  const sevRank: Record<Finding['severity'], number> = { error: 0, warning: 1, info: 2 };
  flat.sort((a, b) => {
    const s = sevRank[a.f.severity] - sevRank[b.f.severity];
    if (s !== 0) return s;
    if (a.f.file !== b.f.file) return a.f.file.localeCompare(b.f.file);
    if ((a.f.line ?? 0) !== (b.f.line ?? 0)) return (a.f.line ?? 0) - (b.f.line ?? 0);
    return a.f.id.localeCompare(b.f.id);
  });

  // Render + truncate.
  const header = renderHeader(options.attempt, options.maxAttempts);
  const footer = renderFooter();
  const headerFooterTokens = estimateTokens(header + footer);
  let budgetLeft = budget - headerFooterTokens;
  const kept: Array<{ gate: string; f: Finding; block: string }> = [];
  let omitted = 0;
  for (let i = 0; i < flat.length; i++) {
    const entry = flat[i]!;
    const block = renderItem(i + 1, entry.gate, entry.f);
    const t = estimateTokens(block);
    if (t > budgetLeft && kept.length > 0) {
      omitted = flat.length - kept.length;
      break;
    }
    budgetLeft -= t;
    kept.push({ ...entry, block });
  }

  const omittedLine =
    omitted > 0
      ? `\n(${omitted} additional finding(s) omitted to stay under the token budget.)\n`
      : '';

  const text = [header, '', ...kept.map((k) => k.block), omittedLine, footer].join('\n');

  const payload = CorrectionPayload.parse({
    attempt: options.attempt,
    max_attempts: options.maxAttempts,
    forbid: FORBID_LIST_TEXT,
    items: kept.map((k) => ({
      gate: k.gate,
      rule_id: k.f.id,
      severity: k.f.severity,
      file: k.f.file,
      line: k.f.line,
      problem: k.f.message,
      fix: k.f.fix_hint,
      rule_ref: k.f.rule_ref,
      spec_ref: k.f.spec_ref,
    })),
    omitted_count: omitted,
  });

  return { text, payload };
}

/* ------------------------------ helpers ------------------------------- */

function renderHeader(attempt: number, maxAttempts: number): string {
  return [
    `SpecGate check failed (attempt ${attempt}/${maxAttempts}). Fix ONLY the issues below; do not change unrelated code.`,
    '',
    FORBID_LIST_TEXT,
  ].join('\n');
}

function renderFooter(): string {
  return 'After fixing, run: specgate check';
}

function renderItem(num: number, gate: string, f: Finding): string {
  const where = f.line != null ? `${f.file}:${f.line}` : f.file;
  const refs: string[] = [];
  if (f.rule_ref) refs.push(f.rule_ref);
  if (f.spec_ref) refs.push(f.spec_ref);
  const ruleLine = refs.length > 0 ? `    Rule/Spec: ${refs.join(', ')}` : '    Rule/Spec: —';
  return [
    `[${num}] ${gate} ${f.id} — ${where}`,
    `    Problem: ${f.message}`,
    `    Do: ${f.fix_hint}`,
    ruleLine,
  ].join('\n');
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
