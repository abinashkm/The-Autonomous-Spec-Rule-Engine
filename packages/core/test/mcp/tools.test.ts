import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getActiveSpec,
  getRule,
  getSpecMarkdown,
  getStatusResource,
  getTaskContext,
  listAllTasks,
  proposeSpecChange,
  runMcpCheck,
  updateTaskStatus,
  UpdateTaskError,
} from '../../src/mcp/tools.js';
import { specApprove, specNew, specTasks } from '../../src/spec/workflow.js';
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
  tmp = mkdtempSync(join(tmpdir(), 'specgate-mcp-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

async function seedSpec(cwd: string): Promise<void> {
  specNew({ cwd, answers: ANSWERS, now: NOW });
  specApprove({ cwd, specIdOrName: 'SPEC-001', now: NOW });
  specTasks({ cwd, specIdOrName: 'SPEC-001', now: NOW });
}

describe('getActiveSpec', () => {
  it('returns null on an empty repo', () => {
    expect(getActiveSpec(tmp)).toBeNull();
  });

  it('returns the newest approved spec with its parsed body', async () => {
    await seedSpec(tmp);
    const active = getActiveSpec(tmp);
    expect(active).not.toBeNull();
    expect(active!.summary.specId).toBe('SPEC-001');
    expect(active!.summary.status).toBe('approved');
    expect(active!.parsed.requirements[0]!.acceptanceCriteria).toHaveLength(2);
  });
});

describe('listAllTasks', () => {
  it('returns tasks across all specs with implements + tags', async () => {
    await seedSpec(tmp);
    const tasks = listAllTasks(tmp);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0]!.specId).toBe('SPEC-001');
    expect(tasks[0]!.implements[0]).toMatch(/^AC-/);
  });

  it('filters by `done`', async () => {
    await seedSpec(tmp);
    expect(listAllTasks(tmp, { done: true })).toEqual([]);
    expect(listAllTasks(tmp, { done: false }).length).toBeGreaterThan(0);
  });
});

describe('getTaskContext (M6.B.2 + M6.D token budget)', () => {
  it('returns the task + ACs for a known task id, empty rules when no packs installed', async () => {
    await seedSpec(tmp);
    const task = listAllTasks(tmp)[0]!;
    const ctx = getTaskContext({ cwd: tmp, taskId: task.id });
    expect(ctx).not.toBeNull();
    expect(ctx!.specId).toBe('SPEC-001');
    expect(ctx!.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(ctx!.rules).toEqual([]);
    expect(ctx!.budget.usedTokens).toBe(0);
  });

  it('returns null for an unknown task id', async () => {
    await seedSpec(tmp);
    expect(getTaskContext({ cwd: tmp, taskId: 'T-999' })).toBeNull();
  });

  it('loads rules from a vendored pack and respects the token budget', async () => {
    await seedSpec(tmp);
    const task = listAllTasks(tmp)[0]!;
    // Vendor a pack with 3 guidance rules; the task has no matching tags, so
    // we'll re-tag the task to backend by rewriting its line to match the pack's
    // scope.
    const packDir = join(tmp, '.specgate', 'rules', 'test-pack');
    mkdirSync(packDir, { recursive: true });
    writeFileSync(
      join(packDir, 'pack.yaml'),
      [
        'name: test-pack',
        'version: 1.0.0',
        'license: MIT',
        'source: original',
        'applies_to:',
        '  languages: [typescript]',
        'guidance:',
        '  - id: LAYER-01',
        '    title: Layer rule 1',
        '    body: ' + 'A'.repeat(200),
        '    scope: { globs: [], tags: [backend] }',
        '    severity: error',
        '  - id: LAYER-02',
        '    title: Layer rule 2',
        '    body: ' + 'B'.repeat(200),
        '    scope: { globs: [], tags: [backend] }',
        '    severity: warning',
      ].join('\n'),
      'utf8',
    );
    // Append `tags: backend` to the task line.
    const tasksPath = join(task.specDir, 'tasks.md');
    const raw = readFileSync(tasksPath, 'utf8');
    writeFileSync(
      tasksPath,
      raw.replace('implements: AC-001.1', 'implements: AC-001.1 — tags: backend'),
      'utf8',
    );

    const ctx = getTaskContext({ cwd: tmp, taskId: task.id, maxTokens: 100 });
    expect(ctx).not.toBeNull();
    // 200-char body ≈ 50 tokens; title+body of a single rule should fit, second shouldn't.
    expect(ctx!.rules.length).toBeGreaterThanOrEqual(1);
    expect(ctx!.budget.usedTokens).toBeGreaterThan(0);
    expect(ctx!.budget.usedTokens).toBeLessThanOrEqual(100);
    if (ctx!.rules.length < 2) {
      expect(ctx!.budget.omittedRules.length).toBeGreaterThan(0);
    }
  });
});

describe('updateTaskStatus (M6.B.4)', () => {
  it('refuses to mark done when no test references any linked AC (E_UNTESTED_AC)', async () => {
    await seedSpec(tmp);
    const task = listAllTasks(tmp)[0]!;
    expect(() => updateTaskStatus({ cwd: tmp, taskId: task.id, done: true })).toThrow(
      UpdateTaskError,
    );
  });

  it('allows marking done once a test file references the AC', async () => {
    await seedSpec(tmp);
    const task = listAllTasks(tmp)[0]!;
    mkdirSync(join(tmp, 'test'), { recursive: true });
    writeFileSync(
      join(tmp, 'test', 'csv.test.ts'),
      `import { it } from 'vitest';\nit('AC-001.1: header row', () => {});\n`,
      'utf8',
    );
    const r = updateTaskStatus({ cwd: tmp, taskId: task.id, done: true });
    expect(r.task.done).toBe(true);
    const body = readFileSync(r.path, 'utf8');
    expect(body).toMatch(new RegExp(`\\[x\\]\\s+\\*{0,2}${task.id}`));
  });

  it('allows marking done→undone unconditionally', async () => {
    await seedSpec(tmp);
    const task = listAllTasks(tmp)[0]!;
    mkdirSync(join(tmp, 'test'), { recursive: true });
    writeFileSync(join(tmp, 'test', 'csv.test.ts'), `it('AC-001.1', () => {});\n`, 'utf8');
    updateTaskStatus({ cwd: tmp, taskId: task.id, done: true });
    const r = updateTaskStatus({ cwd: tmp, taskId: task.id, done: false });
    expect(r.task.done).toBe(false);
  });

  it('errors on unknown task id', () => {
    expect(() => updateTaskStatus({ cwd: tmp, taskId: 'T-999', done: true })).toThrow(
      UpdateTaskError,
    );
  });
});

describe('runMcpCheck (M6.B.5)', () => {
  it('returns results + fix-prompt=null on a clean fixture', async () => {
    // No specs seeded → check runs with no planted violations.
    const r = await runMcpCheck({ cwd: tmp, scope: 'full', gates: ['secrets'] });
    expect(r.results.length).toBe(1);
    expect(r.fixPrompt).toBeNull();
  });
});

describe('getRule (M6.B.6)', () => {
  it('returns null when no packs are installed', () => {
    expect(getRule(tmp, 'LAYER-01')).toBeNull();
  });

  it('finds a rule in a vendored pack', () => {
    const packDir = join(tmp, '.specgate', 'rules', 'p');
    mkdirSync(packDir, { recursive: true });
    writeFileSync(
      join(packDir, 'pack.yaml'),
      [
        'name: p',
        'version: 1.0.0',
        'license: MIT',
        'source: original',
        'applies_to:',
        '  languages: [typescript]',
        'guidance:',
        '  - id: LAYER-01',
        '    title: t',
        '    body: hello body',
        '    scope: { globs: [], tags: [] }',
        '    severity: error',
      ].join('\n'),
      'utf8',
    );
    const r = getRule(tmp, 'LAYER-01');
    expect(r).not.toBeNull();
    expect(r!.title).toBe('t');
    expect(r!.fromPack).toBe('p');
  });
});

describe('proposeSpecChange (M6.B.7)', () => {
  it('writes a NNN.md under .specgate/specs/<dir>/proposals/, never modifies the live spec', async () => {
    await seedSpec(tmp);
    const beforeLive = readFileSync(
      join(tmp, '.specgate', 'specs', '001-csv-export', 'requirements.md'),
      'utf8',
    );
    const r = proposeSpecChange({
      cwd: tmp,
      specIdOrName: 'SPEC-001',
      proposal: {
        specId: 'SPEC-001',
        title: 'Add AC-001.3',
        body: 'Add a new scenario: Given a filtered report, when the user clicks Export, then the CSV reflects the filter.',
      },
      now: NOW,
    });
    expect(existsSync(r.path)).toBe(true);
    expect(r.path).toMatch(/proposals[\\/]001\.md$/);
    // Live spec unchanged.
    expect(
      readFileSync(join(tmp, '.specgate', 'specs', '001-csv-export', 'requirements.md'), 'utf8'),
    ).toBe(beforeLive);
  });

  it('numbers proposals monotonically', async () => {
    await seedSpec(tmp);
    const proposal = {
      specId: 'SPEC-001',
      title: 't',
      body: 'b',
    };
    const r1 = proposeSpecChange({ cwd: tmp, specIdOrName: 'SPEC-001', proposal, now: NOW });
    const r2 = proposeSpecChange({ cwd: tmp, specIdOrName: 'SPEC-001', proposal, now: NOW });
    expect(r1.path).toMatch(/001\.md$/);
    expect(r2.path).toMatch(/002\.md$/);
  });
});

describe('getStatusResource + getSpecMarkdown (M6.C)', () => {
  it('getStatusResource returns an empty-but-valid shape on an empty repo', () => {
    const r = getStatusResource(tmp);
    expect(r.specs).toEqual([]);
    expect(r.tasks).toEqual({ total: 0, done: 0 });
    expect(r.config.strictness).toBe('standard');
  });

  it('getStatusResource summarizes task counts', async () => {
    await seedSpec(tmp);
    const r = getStatusResource(tmp);
    expect(r.specs).toHaveLength(1);
    expect(r.tasks.total).toBeGreaterThan(0);
    expect(r.tasks.done).toBe(0);
  });

  it('getSpecMarkdown returns raw markdown + null for missing ids', async () => {
    expect(getSpecMarkdown(tmp, 'SPEC-001')).toBeNull();
    await seedSpec(tmp);
    expect(getSpecMarkdown(tmp, 'SPEC-001')).toContain('## Requirements');
  });
});
