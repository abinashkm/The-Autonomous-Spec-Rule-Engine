import { describe, expect, it } from 'vitest';
import { ParsedRequirements, ParsedTasks } from '../../src/schemas/spec.js';

/**
 * The §7.1 example turned into the parsed object the Spec Engine will emit (M2.A).
 * At this stage we only validate the schema; parsing from Markdown lands in M2.
 */
const RUN_MD_7_1_REQUIREMENTS = {
  frontmatter: {
    id: 'SPEC-001',
    title: 'CSV export of reports',
    status: 'draft' as const,
    created: '2026-10-14',
  },
  context: 'Plain-language problem statement.',
  requirements: [
    {
      id: 'REQ-001',
      title: 'Users can export a report as CSV',
      acceptanceCriteria: [
        {
          id: 'AC-001.1',
          text: 'Given a report with rows, when the user clicks Export, then a CSV file downloads with a header row.',
          deprecated: false,
        },
        {
          id: 'AC-001.2',
          text: 'Given a report with zero rows, then the CSV contains only the header.',
          deprecated: false,
        },
      ],
      deprecated: false,
    },
  ],
  nonFunctional: [{ id: 'NFR-001', text: 'Export of 100k rows completes in < 10s.' }],
  outOfScope: [],
};

const RUN_MD_7_1_TASKS = {
  tasks: [
    {
      id: 'T-001',
      title: 'Add CSV serializer',
      done: false,
      implements: ['AC-001.1', 'AC-001.2'],
      tags: ['backend', 'export'],
    },
    {
      id: 'T-002',
      title: 'Add export button',
      done: false,
      implements: ['AC-001.1'],
      tags: ['frontend'],
    },
  ],
};

describe('ParsedRequirements', () => {
  it('parses the run.md §7.1 requirements example', () => {
    const parsed = ParsedRequirements.parse(RUN_MD_7_1_REQUIREMENTS);
    expect(parsed.requirements).toHaveLength(1);
    expect(parsed.requirements[0]!.acceptanceCriteria).toHaveLength(2);
  });

  it('rejects duplicate requirement ids', () => {
    const bad = {
      ...RUN_MD_7_1_REQUIREMENTS,
      requirements: [
        ...RUN_MD_7_1_REQUIREMENTS.requirements,
        { ...RUN_MD_7_1_REQUIREMENTS.requirements[0]! },
      ],
    };
    const r = ParsedRequirements.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it('rejects empty acceptance criterion text', () => {
    const bad = structuredClone(RUN_MD_7_1_REQUIREMENTS);
    bad.requirements[0]!.acceptanceCriteria[0]!.text = '';
    const r = ParsedRequirements.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it('rejects a bad REQ id', () => {
    const bad = structuredClone(RUN_MD_7_1_REQUIREMENTS);
    (bad.requirements[0] as { id: string }).id = 'REQ-1';
    const r = ParsedRequirements.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it('rejects a bad AC id', () => {
    const bad = structuredClone(RUN_MD_7_1_REQUIREMENTS);
    (bad.requirements[0]!.acceptanceCriteria[0] as { id: string }).id = 'AC-1-1';
    const r = ParsedRequirements.safeParse(bad);
    expect(r.success).toBe(false);
  });
});

describe('ParsedTasks', () => {
  it('parses the run.md §7.1 tasks example', () => {
    const parsed = ParsedTasks.parse(RUN_MD_7_1_TASKS);
    expect(parsed.tasks[0]!.implements).toEqual(['AC-001.1', 'AC-001.2']);
  });

  it('rejects a task with no implements link', () => {
    const bad = structuredClone(RUN_MD_7_1_TASKS);
    bad.tasks[0]!.implements = [];
    const r = ParsedTasks.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it('rejects duplicate task ids', () => {
    const bad = {
      tasks: [RUN_MD_7_1_TASKS.tasks[0]!, { ...RUN_MD_7_1_TASKS.tasks[0]! }],
    };
    const r = ParsedTasks.safeParse(bad);
    expect(r.success).toBe(false);
  });
});
