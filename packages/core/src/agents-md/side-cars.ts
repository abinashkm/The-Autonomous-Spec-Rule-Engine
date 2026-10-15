import { PRODUCT_NAME } from '../constants.js';

/**
 * Side-car files for agents that prefer their own filename.
 * Source of truth: run.md §9.1 — each must be a thin pointer, no duplication.
 */

export interface SideCar {
  readonly path: string;
  readonly body: string;
}

const SIDECAR_BODY = (name: string): string =>
  [
    `# ${name} — ${PRODUCT_NAME} pointer`,
    '',
    `See [AGENTS.md](AGENTS.md) for the canonical ${PRODUCT_NAME}-managed`,
    'workflow contract, project stack summary, and always-on rules.',
    '',
    `This file exists only because \`${name}\` is the filename this particular`,
    'agent reads by convention. Do not add rules here; add them to the pack',
    `system (\`.specgate/rules/\`) so every agent sees them.`,
    '',
  ].join('\n');

export const SIDE_CARS: readonly SideCar[] = [
  { path: 'CLAUDE.md', body: SIDECAR_BODY('CLAUDE.md') },
  { path: '.cursor/rules/specgate.mdc', body: SIDECAR_BODY('.cursor/rules/specgate.mdc') },
  {
    path: '.github/copilot-instructions.md',
    body: SIDECAR_BODY('.github/copilot-instructions.md'),
  },
  { path: 'GEMINI.md', body: SIDECAR_BODY('GEMINI.md') },
];
