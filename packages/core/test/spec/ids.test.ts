import { describe, expect, it } from 'vitest';
import { isValidId, nextAcId, nextId } from '../../src/spec/ids.js';

describe('isValidId', () => {
  it('accepts canonical formats', () => {
    expect(isValidId('REQ', 'REQ-001')).toBe(true);
    expect(isValidId('AC', 'AC-001.1')).toBe(true);
    expect(isValidId('AC', 'AC-001.42')).toBe(true);
    expect(isValidId('T', 'T-999')).toBe(true);
    expect(isValidId('NFR', 'NFR-001')).toBe(true);
    expect(isValidId('SPEC', 'SPEC-010')).toBe(true);
  });

  it('rejects malformed ids', () => {
    expect(isValidId('REQ', 'REQ-1')).toBe(false);
    expect(isValidId('AC', 'AC-001')).toBe(false);
    expect(isValidId('AC', 'AC-01.1')).toBe(false);
    expect(isValidId('T', 't-001')).toBe(false);
  });
});

describe('nextId', () => {
  it('returns 001 on an empty list', () => {
    expect(nextId('REQ', [])).toBe('REQ-001');
    expect(nextId('T', [])).toBe('T-001');
    expect(nextId('NFR', [])).toBe('NFR-001');
    expect(nextId('SPEC', [])).toBe('SPEC-001');
  });

  it('never fills gaps (run.md §7.1 "never renumber")', () => {
    expect(nextId('REQ', ['REQ-001', 'REQ-003'])).toBe('REQ-004');
    expect(nextId('T', ['T-005', 'T-010', 'T-002'])).toBe('T-011');
  });

  it('ignores ids of the wrong prefix', () => {
    expect(nextId('REQ', ['T-001', 'NFR-001'])).toBe('REQ-001');
  });
});

describe('nextAcId', () => {
  it('returns .1 for an unused REQ', () => {
    expect(nextAcId('REQ-004', [])).toBe('AC-004.1');
  });

  it('never fills gaps within a REQ', () => {
    expect(nextAcId('REQ-001', ['AC-001.1', 'AC-001.3'])).toBe('AC-001.4');
  });

  it('scopes ids to the given REQ', () => {
    expect(nextAcId('REQ-002', ['AC-001.5', 'AC-002.1'])).toBe('AC-002.2');
  });

  it('throws on a bad REQ id', () => {
    expect(() => nextAcId('REQ-1', [])).toThrow(/not a REQ id/);
  });
});
