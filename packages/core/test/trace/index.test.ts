import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildStatusMatrix, buildTraceabilityIndex, isAcDone } from '../../src/trace/index.js';
import { specApprove, specNew, specTasks } from '../../src/spec/workflow.js';
import { updateTaskStatus } from '../../src/mcp/tools.js';
import type { InterviewAnswers } from '../../src/spec/interview/questions.js';

const NOW = () => new Date('2026-10-16T00:00:00Z');

const ANSWERS: InterviewAnswers = {
  name: 'CSV export',
  who: 'report viewers',
  problem: 'Users need portable reports.',
  success: 'A CSV downloads in under 10s.',
  scenarios: [
    'Given a report with rows, when the user clicks Export, then a CSV downloads with a header row.',
    'Given a report with zero rows, then the CSV contains only the header.',
  ],
};

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'specgate-trace-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

async function seedSpec(cwd: string): Promise<void> {
  specNew({ cwd, answers: ANSWERS, now: NOW });
  specApprove({ cwd, specIdOrName: 'SPEC-001', now: NOW });
  specTasks({ cwd, specIdOrName: 'SPEC-001', now: NOW });
}

function writeTestFile(cwd: string, rel: string, body: string): void {
  const abs = join(cwd, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

describe('buildTraceabilityIndex', () => {
  it('builds REQ → AC → Task + AC → Test edges', async () => {
    await seedSpec(tmp);
    writeTestFile(tmp, 'test/csv.test.ts', `it('AC-001.1: header row', () => {});\n`);
    const graph = await buildTraceabilityIndex({ cwd: tmp });
    expect(graph.reqs['REQ-001']).toBeDefined();
    expect(graph.reqs['REQ-001']!.acs).toEqual(['AC-001.1', 'AC-001.2']);
    const ac1 = graph.acs['AC-001.1']!;
    expect(ac1.tasks.length).toBeGreaterThan(0);
    expect(ac1.tests.length).toBe(1);
    expect(ac1.tests[0]!.source).toBe('test-name');
  });

  it('detects orphan tests referencing ids not in any spec', async () => {
    await seedSpec(tmp);
    writeTestFile(tmp, 'test/stale.test.ts', `it('AC-999.1', () => {});\n`);
    const graph = await buildTraceabilityIndex({ cwd: tmp });
    const orphanIds = graph.orphans.map((o) => o.acId);
    expect(orphanIds).toContain('AC-999.1');
  });

  it('empty repo returns an empty graph without throwing', async () => {
    const graph = await buildTraceabilityIndex({ cwd: tmp });
    expect(graph.reqs).toEqual({});
    expect(graph.acs).toEqual({});
    expect(graph.orphans).toEqual([]);
  });
});

describe('isAcDone truth table', () => {
  it('untested when no tests linked', async () => {
    await seedSpec(tmp);
    const graph = await buildTraceabilityIndex({ cwd: tmp });
    expect(isAcDone(graph, 'AC-001.1')).toBe('untested');
  });

  it('passing when test present but tasks still pending (no run data)', async () => {
    await seedSpec(tmp);
    writeTestFile(tmp, 'test/csv.test.ts', `it('AC-001.1: header row', () => {});\n`);
    const graph = await buildTraceabilityIndex({ cwd: tmp });
    expect(isAcDone(graph, 'AC-001.1')).toBe('passing');
  });

  it('done when task is checked AND no run data (assumes green)', async () => {
    await seedSpec(tmp);
    writeTestFile(tmp, 'test/csv.test.ts', `it('AC-001.1: header row', () => {});\n`);
    // Mark the first task done.
    const graph0 = await buildTraceabilityIndex({ cwd: tmp });
    const task = Object.values(graph0.tasks).find((t) => t.implements.includes('AC-001.1'))!;
    updateTaskStatus({ cwd: tmp, taskId: task.id, done: true });
    const graph = await buildTraceabilityIndex({ cwd: tmp });
    expect(isAcDone(graph, 'AC-001.1')).toBe('done');
  });

  it('failing when any linked test is in the failingTests set', async () => {
    await seedSpec(tmp);
    writeTestFile(tmp, 'test/csv.test.ts', `it('AC-001.1: header row', () => {});\n`);
    const graph = await buildTraceabilityIndex({ cwd: tmp });
    const r = isAcDone(graph, 'AC-001.1', {
      failingTests: [{ file: 'test/csv.test.ts', testName: 'AC-001.1' }],
    });
    expect(r).toBe('failing');
  });

  it('deprecated AC is reported as done', async () => {
    await seedSpec(tmp);
    const graph = await buildTraceabilityIndex({ cwd: tmp });
    // Mutate graph in place for the test; prod flow sets this at parse time.
    (graph.acs['AC-001.1'] as { deprecated: boolean }).deprecated = true;
    expect(isAcDone(graph, 'AC-001.1')).toBe('done');
  });
});

describe('buildStatusMatrix', () => {
  it('summarises counts across all ACs', async () => {
    await seedSpec(tmp);
    writeTestFile(tmp, 'test/csv.test.ts', `it('AC-001.1: header row', () => {});\n`);
    const graph = await buildTraceabilityIndex({ cwd: tmp });
    const matrix = buildStatusMatrix(graph);
    expect(matrix.summary.total).toBe(2);
    expect(matrix.summary.passing + matrix.summary.untested).toBe(2);
    expect(matrix.reqs).toHaveLength(1);
  });

  it('exposes orphanTests via buildStatusMatrix', async () => {
    await seedSpec(tmp);
    writeTestFile(tmp, 'test/stale.test.ts', `it('AC-999.1', () => {});\n`);
    const graph = await buildTraceabilityIndex({ cwd: tmp });
    const matrix = buildStatusMatrix(graph);
    expect(matrix.orphanTests.map((o) => o.acId)).toContain('AC-999.1');
  });
});
