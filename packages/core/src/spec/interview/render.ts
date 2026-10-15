import type { InterviewAnswers } from './questions.js';

/**
 * Turn interview answers into a draft `requirements.md`.
 * Source of truth: run.md §7.1 — follow the exact section layout.
 *
 * The emitted spec has:
 *   - status: draft
 *   - REQ-001 titled from `name`, with ACs placeholders drawn from scenarios
 *   - NFR-NNN lines for each nonFunctional entry
 *   - OutOfScope list
 *
 * Placeholders include a visible `TODO:` so the user remembers to flesh out
 * each one before `specgate spec approve`.
 */

export interface RenderDraftOptions {
  readonly specId: string; // SPEC-xxx
  readonly createdDate: string; // YYYY-MM-DD
}

export function renderDraftRequirements(
  answers: InterviewAnswers,
  options: RenderDraftOptions,
): string {
  const scenarios = (answers.scenarios ?? []).filter((s) => s.trim().length > 0);
  const nfr = (answers.nonFunctional ?? []).filter((s) => s.trim().length > 0);
  const oos = (answers.outOfScope ?? []).filter((s) => s.trim().length > 0);

  const lines: string[] = [];
  lines.push('---');
  lines.push(`id: ${options.specId}`);
  lines.push(`title: ${answers.name.trim()}`);
  lines.push('status: draft');
  lines.push(`created: ${options.createdDate}`);
  lines.push('---');
  lines.push('');
  lines.push('## Context');
  lines.push('');
  lines.push(answers.problem.trim());
  lines.push('');
  lines.push(`**Users:** ${answers.who.trim()}`);
  lines.push('');
  lines.push(`**Success looks like:** ${answers.success.trim()}`);
  lines.push('');
  lines.push('## Requirements');
  lines.push(`### REQ-001: ${answers.name.trim()}`);
  if (scenarios.length === 0) {
    lines.push('- **AC-001.1**: TODO describe the first testable scenario (Given/When/Then).');
  } else {
    scenarios.forEach((s, i) => {
      const acId = `AC-001.${i + 1}`;
      // Preserve the user's scenario text verbatim. On `specgate spec approve`,
      // the validator rejects untestable ACs with E_UNTESTABLE_AC (M2.B.2) so
      // the human gets a clear failure instead of a silent inline hint.
      lines.push(`- **${acId}**: ${s.trim()}`);
    });
  }
  lines.push('');
  if (nfr.length > 0) {
    lines.push('## Non-functional');
    nfr.forEach((n, i) => {
      const id = `NFR-${String(i + 1).padStart(3, '0')}`;
      lines.push(`- ${id}: ${n.trim()}`);
    });
    lines.push('');
  }
  if (oos.length > 0) {
    lines.push('## Out of scope');
    for (const o of oos) lines.push(`- ${o.trim()}`);
    lines.push('');
  }
  return lines.join('\n');
}
