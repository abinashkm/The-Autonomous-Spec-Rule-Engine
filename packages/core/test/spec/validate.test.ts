import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ParsedRequirements } from '../../src/schemas/spec.js';
import {
  collectIds,
  readIdsLock,
  validateImmutability,
  validateSpec,
  writeIdsLock,
  type IdsLock,
} from '../../src/spec/validate.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'specgate-validate-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeParsed(overrides: Partial<unknown> = {}) {
  return ParsedRequirements.parse({
    frontmatter: {
      id: 'SPEC-001',
      title: 'x',
      status: 'draft',
      created: '2026-10-15',
    },
    context: '',
    requirements: [
      {
        id: 'REQ-001',
        title: 'r1',
        deprecated: false,
        acceptanceCriteria: [
          {
            id: 'AC-001.1',
            text: 'Given a report, when the user clicks Export, then a file downloads.',
            deprecated: false,
          },
        ],
      },
    ],
    nonFunctional: [],
    outOfScope: [],
    ...(overrides as object),
  });
}

describe('validateSpec', () => {
  it('reports no issues on a well-formed spec', () => {
    const r = validateSpec(makeParsed());
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('flags E_EMPTY_AC when an AC body is whitespace', () => {
    // Build a parsed object that bypasses the schema's non-empty check so we
    // can exercise the validator directly.
    const parsed = makeParsed();
    (parsed.requirements[0]!.acceptanceCriteria[0] as { text: string }).text = '   ';
    const r = validateSpec(parsed);
    expect(r.valid).toBe(false);
    expect(r.issues[0]!.code).toBe('E_EMPTY_AC');
  });

  it('flags E_UNTESTABLE_AC when the AC is too short and lacks when/then', () => {
    const parsed = makeParsed();
    (parsed.requirements[0]!.acceptanceCriteria[0] as { text: string }).text = 'Export works.';
    const r = validateSpec(parsed);
    expect(r.valid).toBe(false);
    expect(r.issues[0]!.code).toBe('E_UNTESTABLE_AC');
  });

  it('accepts an AC with Given/When/Then even if short', () => {
    const parsed = makeParsed();
    (parsed.requirements[0]!.acceptanceCriteria[0] as { text: string }).text =
      'Given X when Y then Z.';
    const r = validateSpec(parsed);
    expect(r.valid).toBe(true);
  });

  it('skips untestability check on deprecated ACs', () => {
    const parsed = makeParsed();
    (parsed.requirements[0]!.acceptanceCriteria[0] as { text: string; deprecated: boolean }).text =
      'tiny';
    (
      parsed.requirements[0]!.acceptanceCriteria[0] as { text: string; deprecated: boolean }
    ).deprecated = true;
    const r = validateSpec(parsed);
    expect(r.valid).toBe(true);
  });
});

describe('ids.lock.json immutability (M2.B.3)', () => {
  it('writes and reads a lock round-trip', () => {
    const lock: IdsLock = {
      specId: 'SPEC-001',
      approvedAt: '2026-10-15T00:00:00.000Z',
      ids: ['AC-001.1', 'REQ-001'],
    };
    writeIdsLock(tmp, lock);
    const read = readIdsLock(tmp);
    expect(read).toEqual(lock);
  });

  it('readIdsLock returns null when the file is absent', () => {
    expect(readIdsLock(tmp)).toBeNull();
  });

  it('flags E_IMMUTABLE_REMOVAL when an approved id disappears', () => {
    const parsed = makeParsed(); // has REQ-001 + AC-001.1
    const originalIds = collectIds(parsed);

    // Remove the only AC.
    (parsed.requirements[0]!.acceptanceCriteria as unknown as unknown[]).length = 0;
    (
      parsed.requirements[0]!.acceptanceCriteria as {
        id: string;
        text: string;
        deprecated: boolean;
      }[]
    ).push({
      id: 'AC-001.2',
      text: 'Given X when Y then Z.',
      deprecated: false,
    });

    const issues = validateImmutability(parsed, {
      specId: 'SPEC-001',
      approvedAt: '2026-10-15T00:00:00.000Z',
      ids: originalIds,
    });
    const ids = issues.map((i) => i.id);
    expect(ids).toContain('AC-001.1');
    expect(issues.every((i) => i.code === 'E_IMMUTABLE_REMOVAL')).toBe(true);
  });

  it('allows ~~deprecated~~ ids to stay in the spec without flagging', () => {
    const parsed = makeParsed();
    const originalIds = collectIds(parsed);
    (parsed.requirements[0]!.acceptanceCriteria[0] as { deprecated: boolean }).deprecated = true;

    const issues = validateImmutability(parsed, {
      specId: 'SPEC-001',
      approvedAt: '2026-10-15T00:00:00.000Z',
      ids: originalIds,
    });
    expect(issues).toEqual([]);
  });

  it('collectIds returns a deterministic sorted list', () => {
    const parsed = ParsedRequirements.parse({
      frontmatter: { id: 'SPEC-001', title: 'x', status: 'draft', created: '2026-10-15' },
      context: '',
      requirements: [
        {
          id: 'REQ-002',
          title: 'b',
          deprecated: false,
          acceptanceCriteria: [
            { id: 'AC-002.1', text: 'Given x when y then z.', deprecated: false },
          ],
        },
        {
          id: 'REQ-001',
          title: 'a',
          deprecated: false,
          acceptanceCriteria: [
            { id: 'AC-001.1', text: 'Given a when b then c.', deprecated: false },
          ],
        },
      ],
      nonFunctional: [{ id: 'NFR-001', text: 'fast' }],
      outOfScope: [],
    });
    expect(collectIds(parsed)).toEqual(['AC-001.1', 'AC-002.1', 'NFR-001', 'REQ-001', 'REQ-002']);
  });
});
