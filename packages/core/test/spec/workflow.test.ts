import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InterviewAnswers } from '../../src/spec/interview/questions.js';
import {
  SPECS_RELDIR,
  SpecWorkflowError,
  computeSpecHash,
  listSpecs,
  specApprove,
  specNew,
  specPlan,
  specTasks,
  specValidate,
  validateTaskLinks,
} from '../../src/spec/workflow.js';
import { parseRequirements } from '../../src/spec/parse.js';
import { readIdsLock } from '../../src/spec/validate.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'specgate-wf-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const FIXED_NOW = () => new Date('2026-10-15T00:00:00Z');

const BASE_ANSWERS: InterviewAnswers = {
  name: 'CSV export of reports',
  who: 'report viewers',
  problem: 'Users need a portable copy of their reports.',
  success: 'A user can click Export and get a CSV in under 10s.',
  scenarios: [
    'Given a report with rows, when the user clicks Export, then a CSV downloads with a header row.',
    'Given a report with zero rows, then the CSV contains only the header.',
  ],
  nonFunctional: ['Export of 100k rows completes in under 10s.'],
  outOfScope: ['Streaming over websockets.'],
};

describe('specNew', () => {
  it('creates .specgate/specs/001-<slug>/requirements.md', () => {
    const result = specNew({ cwd: tmp, answers: BASE_ANSWERS, now: FIXED_NOW });
    expect(result.specId).toBe('SPEC-001');
    const expectedPath = join(tmp, SPECS_RELDIR, '001-csv-export-of-reports', 'requirements.md');
    expect(result.requirementsPath).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    const parsed = parseRequirements(readFileSync(expectedPath, 'utf8'));
    expect(parsed.frontmatter.id).toBe('SPEC-001');
    expect(parsed.frontmatter.status).toBe('draft');
    expect(parsed.requirements[0]!.acceptanceCriteria).toHaveLength(2);
  });

  it('allocates 002, 003, ... never filling gaps', () => {
    specNew({ cwd: tmp, answers: BASE_ANSWERS, now: FIXED_NOW });
    const second = specNew({
      cwd: tmp,
      answers: { ...BASE_ANSWERS, name: 'Another feature' },
      now: FIXED_NOW,
    });
    expect(second.specId).toBe('SPEC-002');
  });

  it('allocates a new NNN prefix even when the auto-increment target is pre-created', () => {
    specNew({ cwd: tmp, answers: BASE_ANSWERS, now: FIXED_NOW });
    // Simulate an operator pre-creating `002-x`. The next prefix bumps to 003
    // and the new spec gets a fresh dir — this is the intended behaviour.
    mkdirSync(join(tmp, SPECS_RELDIR, '002-x'), { recursive: true });
    const result = specNew({
      cwd: tmp,
      answers: { ...BASE_ANSWERS, name: 'Another feature' },
      now: FIXED_NOW,
    });
    expect(result.specId).toBe('SPEC-003');
  });
});

describe('specValidate', () => {
  it('returns valid: true on a well-formed draft', () => {
    const { specId } = specNew({ cwd: tmp, answers: BASE_ANSWERS, now: FIXED_NOW });
    const r = specValidate(tmp, specId);
    expect(r.valid).toBe(true);
  });

  it('flags untestable AC when the user provided one-word scenarios', () => {
    specNew({
      cwd: tmp,
      answers: { ...BASE_ANSWERS, scenarios: ['x'] },
      now: FIXED_NOW,
    });
    const r = specValidate(tmp, 'SPEC-001');
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === 'E_UNTESTABLE_AC')).toBe(true);
  });

  it('throws when the spec id does not exist', () => {
    expect(() => specValidate(tmp, 'SPEC-999')).toThrow(SpecWorkflowError);
  });
});

describe('specApprove', () => {
  it('rejects approval when the spec is invalid', () => {
    specNew({
      cwd: tmp,
      answers: { ...BASE_ANSWERS, scenarios: ['tiny'] },
      now: FIXED_NOW,
    });
    expect(() => specApprove({ cwd: tmp, specIdOrName: 'SPEC-001', now: FIXED_NOW })).toThrow(
      SpecWorkflowError,
    );
  });

  it('flips status to approved and writes ids.lock.json', () => {
    specNew({ cwd: tmp, answers: BASE_ANSWERS, now: FIXED_NOW });
    const result = specApprove({ cwd: tmp, specIdOrName: 'SPEC-001', now: FIXED_NOW });
    expect(result.specId).toBe('SPEC-001');
    expect(result.lock.ids).toContain('REQ-001');
    expect(result.lock.ids).toContain('AC-001.1');

    const reparsed = parseRequirements(
      readFileSync(join(result.specDir, 'requirements.md'), 'utf8'),
    );
    expect(reparsed.frontmatter.status).toBe('approved');
    expect(readIdsLock(result.specDir)).not.toBeNull();
  });

  it('after approval, validate rejects a renumber attempt', () => {
    const nw = specNew({ cwd: tmp, answers: BASE_ANSWERS, now: FIXED_NOW });
    specApprove({ cwd: tmp, specIdOrName: 'SPEC-001', now: FIXED_NOW });
    // User removes AC-001.1 entirely (silent renumber attempt).
    const raw = readFileSync(nw.requirementsPath, 'utf8');
    const edited = raw.replace(/- \*\*AC-001\.1\*\*: [^\n]+\n/, '');
    writeFileSync(nw.requirementsPath, edited, 'utf8');
    const r = specValidate(tmp, 'SPEC-001');
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === 'E_IMMUTABLE_REMOVAL' && i.id === 'AC-001.1')).toBe(
      true,
    );
  });

  it('allows ~~deprecated~~ markers to replace deletions', () => {
    const nw = specNew({ cwd: tmp, answers: BASE_ANSWERS, now: FIXED_NOW });
    specApprove({ cwd: tmp, specIdOrName: 'SPEC-001', now: FIXED_NOW });
    const raw = readFileSync(nw.requirementsPath, 'utf8');
    const edited = raw.replace(/(- \*\*AC-001\.1\*\*: )(.*)$/m, '$1~~$2~~');
    writeFileSync(nw.requirementsPath, edited, 'utf8');
    const r = specValidate(tmp, 'SPEC-001');
    expect(r.immutabilityIssues).toEqual([]);
  });
});

describe('specPlan', () => {
  it('refuses to run on a draft', () => {
    specNew({ cwd: tmp, answers: BASE_ANSWERS, now: FIXED_NOW });
    expect(() => specPlan(tmp, 'SPEC-001')).toThrow(/not approved|still a draft/i);
  });

  it('creates design.md after approval', () => {
    specNew({ cwd: tmp, answers: BASE_ANSWERS, now: FIXED_NOW });
    specApprove({ cwd: tmp, specIdOrName: 'SPEC-001', now: FIXED_NOW });
    const r = specPlan(tmp, 'SPEC-001');
    expect(r.action).toBe('created');
    expect(existsSync(r.designPath)).toBe(true);
    const r2 = specPlan(tmp, 'SPEC-001');
    expect(r2.action).toBe('validated');
  });
});

describe('specTasks', () => {
  it('refuses to run on a draft', () => {
    specNew({ cwd: tmp, answers: BASE_ANSWERS, now: FIXED_NOW });
    expect(() => specTasks({ cwd: tmp, specIdOrName: 'SPEC-001', now: FIXED_NOW })).toThrow(
      /draft|not approved/i,
    );
  });

  it('creates tasks.md + tasks.meta.json; hash is deterministic', () => {
    specNew({ cwd: tmp, answers: BASE_ANSWERS, now: FIXED_NOW });
    specApprove({ cwd: tmp, specIdOrName: 'SPEC-001', now: FIXED_NOW });
    const r = specTasks({ cwd: tmp, specIdOrName: 'SPEC-001', now: FIXED_NOW });
    expect(existsSync(r.tasksPath)).toBe(true);
    expect(existsSync(r.metaPath)).toBe(true);
    const meta = JSON.parse(readFileSync(r.metaPath, 'utf8')) as { specSha256: string };
    expect(meta.specSha256).toHaveLength(64);
    expect(r.specSha256).toBe(meta.specSha256);
  });

  it('spec hash is independent of body cosmetic whitespace', () => {
    specNew({ cwd: tmp, answers: BASE_ANSWERS, now: FIXED_NOW });
    const dir1 = join(tmp, SPECS_RELDIR, '001-csv-export-of-reports');
    const original = readFileSync(join(dir1, 'requirements.md'), 'utf8');
    const parsed1 = parseRequirements(original);
    const parsed2 = parseRequirements(original.replace(/\n\n+/g, '\n\n\n'));
    expect(computeSpecHash(parsed1)).toBe(computeSpecHash(parsed2));
  });

  it('rejects orphan task links on re-run', () => {
    specNew({ cwd: tmp, answers: BASE_ANSWERS, now: FIXED_NOW });
    specApprove({ cwd: tmp, specIdOrName: 'SPEC-001', now: FIXED_NOW });
    const r = specTasks({ cwd: tmp, specIdOrName: 'SPEC-001', now: FIXED_NOW });
    writeFileSync(
      r.tasksPath,
      '## Tasks\n- [ ] **T-050** Phantom — implements: AC-999.9\n',
      'utf8',
    );
    expect(() => specTasks({ cwd: tmp, specIdOrName: 'SPEC-001', now: FIXED_NOW })).toThrow(
      /AC-999\.9/,
    );
  });

  it('validateTaskLinks returns per-task issues (unit)', () => {
    specNew({ cwd: tmp, answers: BASE_ANSWERS, now: FIXED_NOW });
    const parsed = parseRequirements(
      readFileSync(join(tmp, SPECS_RELDIR, '001-csv-export-of-reports', 'requirements.md'), 'utf8'),
    );
    const issues = validateTaskLinks(
      parsed,
      '## Tasks\n- [ ] **T-001** Good — implements: AC-001.1\n- [ ] **T-002** Bad — implements: AC-404.1\n',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.id).toBe('T-002');
  });
});

describe('listSpecs', () => {
  it('reports every spec with its status + title', () => {
    specNew({ cwd: tmp, answers: BASE_ANSWERS, now: FIXED_NOW });
    specNew({ cwd: tmp, answers: { ...BASE_ANSWERS, name: 'Second one' }, now: FIXED_NOW });
    const summaries = listSpecs(tmp);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]!.specId).toBe('SPEC-001');
    expect(summaries[1]!.specId).toBe('SPEC-002');
  });
});
