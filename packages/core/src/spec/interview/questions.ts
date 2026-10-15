/**
 * Interview wizard questions (M2.C.1).
 * Source of truth: run.md §15 ("Interview-first specs: 5-8 plain-language
 * questions; the tool writes the structured spec").
 *
 * Design (ADR-010 standalone mode):
 *   - No LLM in M1 / M2 — the questions produce a *draft* spec with
 *     placeholder ACs the user fills in.
 *   - Inside an agent (M6 MCP), the agent asks these same questions and
 *     calls `spec.write` with its own fleshed-out answers.
 */

export type AnswerKind = 'text' | 'list' | 'scenario';

export interface Question {
  readonly id: string;
  readonly prompt: string;
  readonly kind: AnswerKind;
  readonly required: boolean;
  readonly placeholder?: string;
}

export const INTERVIEW_QUESTIONS: readonly Question[] = [
  {
    id: 'name',
    prompt: 'What is the one-line title of this feature?',
    kind: 'text',
    required: true,
    placeholder: 'e.g. CSV export of reports',
  },
  {
    id: 'who',
    prompt: 'Who uses it?',
    kind: 'text',
    required: true,
    placeholder: 'e.g. report viewers',
  },
  {
    id: 'problem',
    prompt: 'What problem does it solve?',
    kind: 'text',
    required: true,
    placeholder: 'In plain language. Two or three sentences.',
  },
  {
    id: 'success',
    prompt: 'What does success look like?',
    kind: 'text',
    required: true,
    placeholder: 'e.g. a user can download a CSV of any report in under 10s.',
  },
  {
    id: 'scenarios',
    prompt: 'Give 1–3 concrete scenarios the feature must handle.',
    kind: 'list',
    required: true,
    placeholder: 'One scenario per line.',
  },
  {
    id: 'nonFunctional',
    prompt: 'Any non-functional constraints?',
    kind: 'list',
    required: false,
    placeholder: 'e.g. completes in < 10s; works offline.',
  },
  {
    id: 'outOfScope',
    prompt: 'What is explicitly OUT of scope?',
    kind: 'list',
    required: false,
    placeholder: 'One item per line.',
  },
];

export interface InterviewAnswers {
  readonly name: string;
  readonly who: string;
  readonly problem: string;
  readonly success: string;
  readonly scenarios: readonly string[];
  readonly nonFunctional?: readonly string[];
  readonly outOfScope?: readonly string[];
}
