import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SPECS_RELDIR,
  SpecWorkflowError,
  specApprove,
  specNew,
  specPlan,
  specTasks,
  specValidate,
} from '../../src/spec/workflow.js';
import type { InterviewAnswers } from '../../src/spec/interview/questions.js';

/**
 * M2 exit DoD (verbatim from PLAN.md M2):
 *   > full `spec new → validate → approve → plan → tasks` round trip works;
 *   > renumbering is rejected; untestable ACs are flagged.
 *
 * This test exercises the full round trip in one file so it's easy to see
 * at a glance that the milestone's exit criteria hold.
 */

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'specgate-m2-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const NOW = () => new Date('2026-10-16T00:00:00Z');

const GOOD_ANSWERS: InterviewAnswers = {
  name: 'CSV export of reports',
  who: 'report viewers',
  problem: 'Users need a portable copy of their reports.',
  success: 'Clicking Export produces a CSV in under 10s.',
  scenarios: [
    'Given a report with rows, when the user clicks Export, then a CSV file downloads with a header row.',
    'Given a report with zero rows, then the CSV contains only the header row.',
  ],
  nonFunctional: ['Export of 100k rows completes in under 10s.'],
  outOfScope: ['Streaming over websockets.'],
};

describe('M2 exit DoD — full spec engine round trip', () => {
  it('new → validate → approve → plan → tasks works, and renumbering is rejected', () => {
    // Step 1: new
    const nw = specNew({ cwd: tmp, answers: GOOD_ANSWERS, now: NOW });
    expect(nw.specId).toBe('SPEC-001');
    expect(existsSync(nw.requirementsPath)).toBe(true);

    // Step 2: validate (draft)
    const v = specValidate(tmp, 'SPEC-001');
    expect(v.valid).toBe(true);

    // Step 3: approve
    const a = specApprove({ cwd: tmp, specIdOrName: 'SPEC-001', now: NOW });
    expect(a.lock.ids).toEqual(
      expect.arrayContaining(['REQ-001', 'AC-001.1', 'AC-001.2', 'NFR-001']),
    );

    // Step 4: plan
    const p = specPlan(tmp, 'SPEC-001');
    expect(existsSync(p.designPath)).toBe(true);

    // Step 5: tasks
    const t = specTasks({ cwd: tmp, specIdOrName: 'SPEC-001', now: NOW });
    expect(existsSync(t.tasksPath)).toBe(true);
    expect(existsSync(t.metaPath)).toBe(true);
    expect(t.specSha256).toHaveLength(64);

    // Renumbering attempt: delete AC-001.1 (no `~~deprecated~~` marker).
    const raw = readFileSync(nw.requirementsPath, 'utf8');
    writeFileSync(nw.requirementsPath, raw.replace(/- \*\*AC-001\.1\*\*: [^\n]+\n/, ''), 'utf8');
    const v2 = specValidate(tmp, 'SPEC-001');
    expect(v2.valid).toBe(false);
    expect(v2.immutabilityIssues.some((i) => i.id === 'AC-001.1')).toBe(true);
  });

  it('untestable ACs are flagged on validate (one-word scenario)', () => {
    specNew({
      cwd: tmp,
      answers: { ...GOOD_ANSWERS, scenarios: ['works'] },
      now: NOW,
    });
    const r = specValidate(tmp, 'SPEC-001');
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === 'E_UNTESTABLE_AC')).toBe(true);
  });

  it('spec plan refuses on draft (status check holds)', () => {
    specNew({ cwd: tmp, answers: GOOD_ANSWERS, now: NOW });
    expect(() => specPlan(tmp, 'SPEC-001')).toThrow(SpecWorkflowError);
  });

  it('spec tasks rejects an orphan AC link when the user hand-edits tasks.md', () => {
    specNew({ cwd: tmp, answers: GOOD_ANSWERS, now: NOW });
    specApprove({ cwd: tmp, specIdOrName: 'SPEC-001', now: NOW });
    const t = specTasks({ cwd: tmp, specIdOrName: 'SPEC-001', now: NOW });
    writeFileSync(
      t.tasksPath,
      '## Tasks\n- [ ] **T-050** Phantom — implements: AC-404.1\n',
      'utf8',
    );
    expect(() => specTasks({ cwd: tmp, specIdOrName: 'SPEC-001', now: NOW })).toThrow(/AC-404\.1/);
  });

  it('the spec dir layout matches run.md §6', () => {
    specNew({ cwd: tmp, answers: GOOD_ANSWERS, now: NOW });
    const dir = join(tmp, SPECS_RELDIR, '001-csv-export-of-reports');
    expect(existsSync(join(dir, 'requirements.md'))).toBe(true);
    specApprove({ cwd: tmp, specIdOrName: 'SPEC-001', now: NOW });
    expect(existsSync(join(dir, 'ids.lock.json'))).toBe(true);
    specPlan(tmp, 'SPEC-001');
    expect(existsSync(join(dir, 'design.md'))).toBe(true);
    specTasks({ cwd: tmp, specIdOrName: 'SPEC-001', now: NOW });
    expect(existsSync(join(dir, 'tasks.md'))).toBe(true);
    expect(existsSync(join(dir, 'tasks.meta.json'))).toBe(true);
  });
});
