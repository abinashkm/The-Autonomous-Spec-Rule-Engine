import { describe, expect, it } from 'vitest';
import { parseRequirements, parseTasks, SpecParseError } from '../../src/spec/parse.js';

const RUN_MD_REQUIREMENTS = `---
id: SPEC-001
title: CSV export of reports
status: draft
created: 2026-10-14
---

## Context
Plain-language problem statement.

## Requirements
### REQ-001: Users can export a report as CSV
- **AC-001.1**: Given a report with rows, when the user clicks Export, then a CSV file downloads with a header row.
- **AC-001.2**: Given a report with zero rows, then the CSV contains only the header.

### REQ-002: Downloaded file is UTF-8
- **AC-002.1**: The downloaded CSV uses UTF-8 encoding with a BOM.

## Non-functional
- NFR-001: Export of 100k rows completes in < 10s.

## Out of scope
- Streaming export over websockets.
`;

const RUN_MD_TASKS = `## Tasks
- [ ] **T-001** Add CSV serializer — implements: AC-001.1, AC-001.2 — tags: backend, export
- [ ] **T-002** Add export button — implements: AC-001.1 — tags: frontend
- [x] **T-003** Pick file encoding library — implements: AC-002.1
`;

describe('parseRequirements', () => {
  it('parses the run.md §7.1 example into the expected shape', () => {
    const parsed = parseRequirements(RUN_MD_REQUIREMENTS);
    expect(parsed.frontmatter.id).toBe('SPEC-001');
    expect(parsed.frontmatter.status).toBe('draft');
    expect(parsed.context).toContain('Plain-language problem statement.');
    expect(parsed.requirements).toHaveLength(2);
    expect(parsed.requirements[0]!.acceptanceCriteria).toHaveLength(2);
    expect(parsed.requirements[0]!.acceptanceCriteria[0]!.id).toBe('AC-001.1');
    expect(parsed.requirements[0]!.acceptanceCriteria[0]!.text).toMatch(/Given a report/);
    expect(parsed.nonFunctional).toEqual([
      { id: 'NFR-001', text: 'Export of 100k rows completes in < 10s.' },
    ]);
    expect(parsed.outOfScope).toContain('Streaming export over websockets.');
  });

  it('throws on malformed frontmatter', () => {
    const bad = RUN_MD_REQUIREMENTS.replace('status: draft', 'status: yolo');
    expect(() => parseRequirements(bad)).toThrow();
  });

  it('throws when ## Requirements is missing', () => {
    expect(() =>
      parseRequirements(
        `---\nid: SPEC-001\ntitle: x\nstatus: draft\ncreated: 2026-10-14\n---\n\n## Context\nhi\n`,
      ),
    ).toThrow(SpecParseError);
  });

  it('rejects a requirement with zero acceptance criteria at the schema level', () => {
    const bad = RUN_MD_REQUIREMENTS.replace(
      /- \*\*AC-001\.1\*\*: [^\n]+\n- \*\*AC-001\.2\*\*: [^\n]+/,
      '(no acs at all)',
    );
    expect(() => parseRequirements(bad)).toThrow();
  });

  it('marks deprecated ACs (~~...~~) but keeps their id', () => {
    const body = RUN_MD_REQUIREMENTS.replace(
      /AC-001\.2\*\*: Given a report with zero rows[^\n]+/,
      'AC-001.2**: ~~Given a report with zero rows, then the CSV contains only the header.~~',
    );
    const parsed = parseRequirements(body);
    const ac = parsed.requirements[0]!.acceptanceCriteria.find((a) => a.id === 'AC-001.2');
    expect(ac?.deprecated).toBe(true);
  });

  it('rejects a REQ heading that is not formatted as `REQ-xxx: title`', () => {
    const bad = RUN_MD_REQUIREMENTS.replace('REQ-001: Users', 'My ad-hoc heading');
    expect(() => parseRequirements(bad)).toThrow(SpecParseError);
  });
});

describe('parseTasks', () => {
  it('parses the run.md §7.1 tasks example', () => {
    const parsed = parseTasks(RUN_MD_TASKS);
    expect(parsed.tasks).toHaveLength(3);
    expect(parsed.tasks[0]!.id).toBe('T-001');
    expect(parsed.tasks[0]!.implements).toEqual(['AC-001.1', 'AC-001.2']);
    expect(parsed.tasks[0]!.tags).toEqual(['backend', 'export']);
    expect(parsed.tasks[2]!.done).toBe(true);
  });

  it('parses tasks without tags', () => {
    const parsed = parseTasks(`## Tasks\n- [ ] **T-010** Foo — implements: AC-001.1\n`);
    expect(parsed.tasks[0]!.implements).toEqual(['AC-001.1']);
    expect(parsed.tasks[0]!.tags).toEqual([]);
  });

  it('rejects a duplicate task id via the schema', () => {
    expect(() =>
      parseTasks(
        `## Tasks\n- [ ] **T-001** Foo — implements: AC-001.1\n- [ ] **T-001** Bar — implements: AC-001.2\n`,
      ),
    ).toThrow();
  });

  it('silently ignores rows that are not T-xxx tasks', () => {
    const parsed = parseTasks(
      `## Tasks\n- [ ] **T-001** Real — implements: AC-001.1\n- [ ] a stray bullet\n- some other line\n`,
    );
    expect(parsed.tasks).toHaveLength(1);
  });
});
